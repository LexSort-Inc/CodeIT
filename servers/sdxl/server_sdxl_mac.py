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
import gc
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

# Model registry: additional checkpoints live side-by-side under MODELS_ROOT
# (defaults to the parent of the resolved MODEL_DIR, e.g. AI_Models/).
# Entries appear in the app picker when their weights are present on disk.
MODELS_ROOT = os.path.expanduser(os.getenv(
    "MODELS_ROOT", os.path.dirname(os.path.dirname(os.path.realpath(MODEL_DIR)))))
REGISTRY = [
    {"id": "pony-v6-xl", "label": "Pony V6 XL", "dir": "pony-models/pony-v6-xl",
     "prefix": "score_9, score_8_up, score_7_up, ",
     "best_for": "Characters, anime style, huge LoRA library"},
    {"id": "noobai-xl", "label": "NoobAI-XL Eps 1.1", "dir": "noobai-xl",
     "prefix": "",
     "best_for": "Cleanest anime faces/hands, character accuracy"},
    {"id": "illustrious-xl", "label": "Illustrious-XL v2.0", "dir": "illustrious-xl",
     "prefix": "",
     "best_for": "Neutral canvas, prompt separation, 1536px native"},
]

app = FastAPI(title="CodeIT SDXL Mac")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

pipe = None
load_error = None


pipe = None
pipe_model = None
load_error = None


def entry_dir(entry):
    d = entry["dir"]
    return d if os.path.isabs(d) else os.path.join(MODELS_ROOT, d)


def has_weights(entry):
    d = entry_dir(entry)
    if os.path.isdir(os.path.join(d, "unet")) or os.path.isfile(os.path.join(d, "model_index.json")):
        return True
    try:
        return any(f.endswith(".safetensors") for f in os.listdir(d))
    except OSError:
        return False


def registry_status():
    return [
        {"id": e["id"], "label": e["label"], "best_for": e["best_for"],
         "available": has_weights(e), "active": (e["id"] == pipe_model)}
        for e in REGISTRY
    ]


def unload_pipe():
    global pipe, pipe_model
    pipe = None
    pipe_model = None
    gc.collect()
    try:
        torch.mps.empty_cache()
    except Exception:
        pass


def load_pipe(model_id=None):
    global pipe, pipe_model, load_error
    want = model_id or pipe_model or REGISTRY[0]["id"]
    if pipe is not None and pipe_model == want:
        return
    if pipe is not None:
        print(f"[sdxl-mac] switching model {pipe_model} -> {want}", flush=True)
        unload_pipe()
    entry = next((e for e in REGISTRY if e["id"] == want), REGISTRY[0])
    target = entry_dir(entry)
    try:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        # fp16 safetensors on disk are named *.fp16.safetensors -> variant="fp16".
        kwargs = {"torch_dtype": torch.float16, "use_safetensors": True, "variant": "fp16"}
        # Prefer diffusers folder layout; fall back to single checkpoint file.
        if os.path.isdir(os.path.join(target, "unet")) or os.path.isfile(
            os.path.join(target, "model_index.json")
        ):
            loaded = StableDiffusionXLPipeline.from_pretrained(target, **kwargs)
        else:
            ckpts = sorted(glob.glob(os.path.join(target, "*.safetensors")))
            if not ckpts:
                raise RuntimeError(f"no diffusers folder or .safetensors in {target}")
            # variant=fp16 only applies to folder layouts; single files carry their own dtype
            skwargs = {"torch_dtype": torch.float16}
            try:
                loaded = StableDiffusionXLPipeline.from_single_file(ckpts[0], **skwargs)
            except TypeError:
                loaded = StableDiffusionXLPipeline.from_single_file(ckpts[0])
        pipe = loaded.to(device)
        pipe_model = entry["id"]
        load_error = None
        # 16GB unified memory: keep VAE in fp32 for quality, slice attention to fit.
        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass
        print(f"[sdxl-mac] loaded {entry['id']} on {device} from {target}", flush=True)
    except Exception as e:  # noqa: BLE001 — surfaced via /info
        pipe = None
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
    model: str = ""  # registry id; empty = current. Switching unloads + lazy-loads.


@app.get("/info")
def info():
    load_pipe()
    entry = next((e for e in REGISTRY if e["id"] == pipe_model), REGISTRY[0])
    return {
        "model": entry["id"],
        "model_label": entry["label"],
        "models": registry_status(),
        "backend": "diffusers",
        "device": "mps" if torch.backends.mps.is_available() else "cpu",
        "dtype": "fp16",
        "ready": pipe is not None,
        "error": load_error,
    }


class ModelReq(BaseModel):
    id: str


@app.post("/model")
def switch_model(req: ModelReq):
    global pipe_model
    if not any(e["id"] == req.id for e in REGISTRY):
        raise HTTPException(status_code=404, detail=f"unknown model {req.id}")
    entry = next(e for e in REGISTRY if e["id"] == req.id)
    if not has_weights(entry):
        raise HTTPException(status_code=404, detail=f"weights not downloaded for {req.id}")
    if pipe_model != req.id:
        unload_pipe()
        # Actual load happens on next /info or /generate (minutes); client polls.
        pipe_model = req.id
    return {"ok": True, "active": pipe_model, "models": registry_status()}


@app.post("/generate")
def generate(req: GenReq, format: str = "json"):
    if req.model:
        load_pipe(req.model)
    else:
        load_pipe()
    if pipe is None:
        raise HTTPException(status_code=503, detail=load_error or "model not loaded")
    entry = next((e for e in REGISTRY if e["id"] == pipe_model), REGISTRY[0])
    w = max(256, min(1536, int(req.width)))
    h = max(256, min(1536, int(req.height)))
    steps = max(5, min(60, int(req.steps)))
    seed = req.seed if req.seed >= 0 else int(time.time()) % 2**31
    gen = torch.Generator(device="mps" if torch.backends.mps.is_available() else "cpu").manual_seed(seed)
    t0 = time.time()
    # Per-model prompt boilerplate (Pony score tags; others plain NL).
    prompt = f"{entry.get('prefix', '')}{req.prompt}"
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
