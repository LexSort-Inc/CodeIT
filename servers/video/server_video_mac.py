#!/usr/bin/env python3
"""CodeIT local video server — LTX-Video 2B on Apple Silicon.

Sibling of the SDXL image server; image pipeline untouched.
Same contract shape, video payload:
  GET  /info      -> { model, backend, device, dtype, ready }
  POST /generate  -> { video_b64, width, height, frames, fps, seed, ms } (mp4)
                      or raw MP4 bytes with ?format=mp4

Run:
  MODEL_DIR=~/PonyServer/Models/ltx-video PORT=8003 ~/.venv/bin/python server_video_mac.py
CodeIT app talks to http://127.0.0.1:8003 directly (CORS open for localhost).
"""

import base64
import io
import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

import imageio.v2 as imageio
import numpy as np
import torch
from diffusers import LTXPipeline

MODEL_DIR = os.path.expanduser(os.getenv("MODEL_DIR", "~/PonyServer/Models/ltx-video"))
PORT = int(os.getenv("PORT", "8003"))
MODEL_ID = "Lightricks/LTX-Video"

app = FastAPI(title="CodeIT Video Mac")
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
        pipe = LTXPipeline.from_pretrained(MODEL_DIR, torch_dtype=torch.float16)
        pipe = pipe.to(device)
        try:
            pipe.enable_attention_slicing()
        except Exception:
            pass
        print(f"[video-mac] loaded on {device} from {MODEL_DIR}", flush=True)
    except Exception as e:  # noqa: BLE001 — surfaced via /info
        load_error = str(e)[:500]
        print(f"[video-mac] load failed: {load_error}", flush=True)


class GenReq(BaseModel):
    prompt: str
    negative_prompt: str = "worst quality, blurry, watermark, text, deformed"
    width: int = 768
    height: int = 512
    frames: int = 49
    fps: int = 24
    steps: int = 30
    guidance: float = 3.0
    seed: int = -1


@app.get("/info")
def info():
    load_pipe()
    return {
        "model": MODEL_ID,
        "backend": "diffusers-ltx",
        "device": "mps" if torch.backends.mps.is_available() else "cpu",
        "dtype": "fp16",
        "ready": pipe is not None,
        "error": load_error,
    }


def frames_to_mp4(frames, fps):
    buf = io.BytesIO()
    # imageio-ffmpeg bundles its own ffmpeg binary — no system install needed.
    with imageio.get_writer(buf, format="mp4", fps=fps, codec="libx264", quality=8) as w:
        for f in frames:
            arr = (np.asarray(f).clip(0, 255)).astype(np.uint8) if np.asarray(f).max() <= 1.0 else np.asarray(f).astype(np.uint8)
            w.append_data(arr)
    return buf.getvalue()


@app.post("/generate")
def generate(req: GenReq, format: str = "json"):
    load_pipe()
    if pipe is None:
        raise HTTPException(status_code=503, detail=load_error or "model not loaded")
    # LTX likes multiples of 32 spatial, frames = 8k+1.
    w = max(256, min(1024, int(req.width))) // 32 * 32
    h = max(256, min(1024, int(req.height))) // 32 * 32
    frames = min(161, max(9, int(req.frames)))
    frames = (frames - 1) // 8 * 8 + 1
    steps = max(5, min(60, int(req.steps)))
    seed = req.seed if req.seed >= 0 else int(time.time()) % 2**31
    gen = torch.Generator(device="mps" if torch.backends.mps.is_available() else "cpu").manual_seed(seed)
    t0 = time.time()
    with torch.inference_mode():
        out = pipe(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            width=w,
            height=h,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=float(req.guidance),
            generator=gen,
        )
    mp4 = frames_to_mp4(out.frames[0], fps=max(8, min(30, int(req.fps))))
    ms = int((time.time() - t0) * 1000)
    if format == "mp4":
        return Response(content=mp4, media_type="video/mp4")
    return {
        "video_b64": base64.b64encode(mp4).decode(),
        "width": w,
        "height": h,
        "frames": frames,
        "fps": max(8, min(30, int(req.fps))),
        "seed": seed,
        "ms": ms,
    }


if __name__ == "__main__":
    import uvicorn

    load_pipe()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
