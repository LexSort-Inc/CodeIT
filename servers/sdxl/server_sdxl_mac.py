#!/usr/bin/env python3
"""CodeIT local image server — Pony Diffusion V6 XL (SDXL) on Apple Silicon.

Mac (MPS, fp16) quality endpoint. Same contract as other CodeIT quality servers:
  GET  /info      -> { model, backend, device, dtype, ready }
  POST /generate  -> { image_b64, width, height, seed, ms }  (JSON) or PNG bytes (?format=png)

Run:
  MODEL_DIR=~/PonyServer/Models/pony-v6-xl PORT=8002 ~/.venv/bin/python server_sdxl_mac.py
CodeIT app talks to http://127.0.0.1:8002 directly (CORS open for localhost).
"""

import base64
import io
import os
import time
import glob

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

import torch
from diffusers import StableDiffusionXLPipeline
from PIL import Image

MODEL_DIR = os.path.expanduser(os.getenv("MODEL_DIR", "~/PonyServer/Models/pony-v6-xl"))
PORT = int(os.getenv("PORT", "8002"))
MODEL_ID = "stablediffusionapi/Pony-Diffusion-V6-XL"

app = FastAPI(title="CodeIT SDXL Mac")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

pipe = None
load_error = None


def load_pipe():
    global pipe, load_error
    if pipe is not None or load_error is not None:
        return
    try:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        kwargs = {"torch_dtype": torch.float16, "use_safetensors": True}
        # Prefer diffusers folder layout; fall back to single checkpoint file.
        if os.path.isdir(os.path.join(MODEL_DIR, "unet")) or os.path.isfile(
            os.path.join(MODEL_DIR, "model_index.json")
        ):
            pipe = StableDiffusionXLPipeline.from_pretrained(MODEL_DIR, **kwargs)
        else:
            ckpts = sorted(glob.glob(os.path.join(MODEL_DIR, "*.safetensors")))
            if not ckpts:
                raise RuntimeError(f"no diffusers folder or .safetensors in {MODEL_DIR}")
            pipe = StableDiffusionXLPipeline.from_single_file(ckpts[0], **kwargs)
        pipe = pipe.to(device)
        # 16GB unified memory: keep VAE in fp32 for quality, slice attention to fit.
        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass
        print(f"[sdxl-mac] loaded on {device} from {MODEL_DIR}", flush=True)
    except Exception as e:  # noqa: BLE001 — surfaced via /info
        load_error = str(e)[:500]
        print(f"[sdxl-mac] load failed: {load_error}", flush=True)


class GenReq(BaseModel):
    prompt: str
    negative_prompt: str = "lowres, bad anatomy, blurry, watermark, text"
    width: int = 1024
    height: int = 1024
    steps: int = 28
    guidance: float = 7.0
    seed: int = -1


@app.get("/info")
def info():
    load_pipe()
    return {
        "model": MODEL_ID,
        "backend": "diffusers",
        "device": "mps" if torch.backends.mps.is_available() else "cpu",
        "dtype": "fp16",
        "ready": pipe is not None,
        "error": load_error,
    }


@app.post("/generate")
def generate(req: GenReq, format: str = "json"):
    load_pipe()
    if pipe is None:
        raise HTTPException(status_code=503, detail=load_error or "model not loaded")
    w = max(256, min(1536, int(req.width)))
    h = max(256, min(1536, int(req.height)))
    steps = max(5, min(60, int(req.steps)))
    seed = req.seed if req.seed >= 0 else int(time.time()) % 2**31
    gen = torch.Generator(device="mps" if torch.backends.mps.is_available() else "cpu").manual_seed(seed)
    t0 = time.time()
    # Pony V6 XL likes score tags; prepend a quality boilerplate.
    prompt = f"score_9, score_8_up, score_7_up, {req.prompt}"
    with torch.inference_mode():
        out = pipe(
            prompt=prompt,
            negative_prompt=req.negative_prompt,
            width=w,
            height=h,
            num_inference_steps=steps,
            guidance_scale=float(req.guidance),
            generator=gen,
        )
    img: Image.Image = out.images[0]
    ms = int((time.time() - t0) * 1000)
    if format == "png":
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {
        "image_b64": base64.b64encode(buf.getvalue()).decode(),
        "width": w,
        "height": h,
        "seed": seed,
        "ms": ms,
    }


if __name__ == "__main__":
    import uvicorn

    load_pipe()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
