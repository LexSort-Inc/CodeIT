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
import glob
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
from diffusers import LTXPipeline, LTXImageToVideoPipeline
from PIL import Image
from transformers import T5EncoderModel

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
i2v_pipe = None
load_error = None


def make_text_encoder():
    # 9GB T5-XXL on a busy 16GB desktop: stream weights straight onto devices
    # with disk offload instead of staging it all in RAM at load time.
    offload = os.path.join(os.path.expanduser("~/PonyServer"), ".t5-offload")
    os.makedirs(offload, exist_ok=True)
    return T5EncoderModel.from_pretrained(
        MODEL_DIR, subfolder="text_encoder", torch_dtype=torch.float16,
        device_map="auto", offload_folder=offload,
        offload_state_dict=True,
    )


def load_i2v():
    global i2v_pipe, load_error
    if i2v_pipe is not None:
        return True
    try:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        ckpt = find_ckpt()
        i2v_pipe = LTXImageToVideoPipeline.from_single_file(
            ckpt, torch_dtype=torch.float16,
            text_encoder=make_text_encoder())
        try:
            # No-op when components are device-mapped already.
            i2v_pipe = i2v_pipe.to(device)
        except Exception:
            pass
        # Belt-and-braces: from_single_file can leave the injected text
        # encoder behind on CPU -> "Passed CPU tensor to MPS op" at encode.
        try:
            if getattr(i2v_pipe, "text_encoder", None) is not None:
                i2v_pipe.text_encoder = i2v_pipe.text_encoder.to(device)
        except Exception as e:  # noqa: BLE001
            print(f"[video-mac] text-encoder move: {str(e)[:200]}", flush=True)
        try:
            devs = {}
            for cname in ("text_encoder", "transformer", "vae"):
                comp = getattr(i2v_pipe, cname, None)
                try:
                    devs[cname] = str(next(comp.parameters()).device)
                except Exception:
                    devs[cname] = "?"
            print(f"[video-mac] i2v devices: {devs}", flush=True)
        except Exception:
            pass
        try:
            # Keep everything on MPS (sequential offload breaks text-encoder
            # device placement in the i2v path: "Passed CPU tensor to MPS op").
            # Exception: VAE stays on CPU — its weights don't reliably follow
            # .to(device) from single-file loads, and prepare_latents moves
            # latents onto MPS itself. Slower decode, zero mismatch crashes.
            i2v_pipe.enable_attention_slicing()
            i2v_pipe.vae.to("cpu")
            i2v_pipe.vae.enable_tiling()
        except Exception:
            pass
        print("[video-mac] i2v loaded", flush=True)
        return True
    except Exception as e:  # noqa: BLE001
        load_error = str(e)[:500]
        print(f"[video-mac] i2v load failed: {load_error}", flush=True)
        return False


def find_ckpt():
    ckpt = os.path.join(MODEL_DIR, "ltx-video-2b-v0.9.5.safetensors")
    if not os.path.isfile(ckpt):
        alt = sorted(glob.glob(os.path.join(MODEL_DIR, "*2b*.safetensors")))
        if not alt:
            raise RuntimeError(f"no LTX 2B checkpoint in {MODEL_DIR}")
        ckpt = alt[0]
    return ckpt


def load_pipe():
    global pipe, load_error
    if pipe is not None or load_error is not None:
        return
    try:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        # Single-file 2B checkpoint (repo has no diffusers folder layout for 2B).
        ckpt = find_ckpt()
        pipe = LTXPipeline.from_single_file(ckpt, torch_dtype=torch.float16,
            text_encoder=make_text_encoder())
        try:
            pipe = pipe.to(device)
        except Exception:
            pass
        try:
            if getattr(pipe, "text_encoder", None) is not None:
                pipe.text_encoder = pipe.text_encoder.to(device)
        except Exception as e:  # noqa: BLE001
            print(f"[video-mac] text-encoder move: {str(e)[:200]}", flush=True)
        try:
            # Pinned on MPS with slicing (sequential offload races text-encoder
            # placement in this path: "Passed CPU tensor to MPS op").
            pipe.enable_attention_slicing()
            pipe.vae.enable_tiling()
        except Exception:
            pass
        print(f"[video-mac] loaded on {device} from {MODEL_DIR}", flush=True)
    except Exception as e:  # noqa: BLE001 — surfaced via /info
        load_error = str(e)[:500]
        print(f"[video-mac] load failed: {load_error}", flush=True)


class GenReq(BaseModel):
    prompt: str
    negative_prompt: str = "worst quality, inconsistent motion, blurry, jittery, distorted, flickering, watermark, text"
    width: int = 768
    height: int = 512
    frames: int = 49
    fps: int = 24
    steps: int = -1  # -1 = recipe default (dev 45, fast 20)
    guidance: float = -1.0  # -1 = recipe default (dev 3.5, fast 1.0)
    recipe: str = "dev"  # dev (0.9.x non-distilled weights) | fast (distilled-style)
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
        "i2v_ready": i2v_pipe is not None,
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
    dev = (req.recipe or "dev").lower() != "fast"
    steps = int(req.steps) if int(req.steps) > 0 else (45 if dev else 20)
    steps = max(5, min(60, steps))
    guidance = float(req.guidance) if float(req.guidance) > 0 else (3.5 if dev else 1.0)
    seed = req.seed if req.seed >= 0 else int(time.time()) % 2**31
    gen = torch.Generator(device="mps" if torch.backends.mps.is_available() else "cpu").manual_seed(seed)
    t0 = time.time()
    call = dict(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        width=w,
        height=h,
        num_frames=frames,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=gen,
    )
    if dev:
        # 0.9.x dev recipe: proper decode schedule + rescaled guidance.
        call.update(decode_timestep=0.05, decode_noise_scale=0.025, guidance_rescale=0.7)
    with torch.inference_mode():
        out = pipe(**call)
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


class AnimateReq(BaseModel):
    image_b64: str  # PNG/JPEG source frame (e.g. a Pony still)
    prompt: str = ""  # motion description; image dominates
    negative_prompt: str = "worst quality, inconsistent motion, blurry, jittery, distorted, flickering"
    width: int = 768
    height: int = 512
    frames: int = 49
    fps: int = 24
    steps: int = 30
    guidance: float = 3.0
    seed: int = -1


@app.post("/animate")
def animate(req: AnimateReq, format: str = "json"):
    if not load_i2v():
        raise HTTPException(status_code=503, detail=load_error or "i2v not loaded")
    try:
        src = Image.open(io.BytesIO(base64.b64decode(req.image_b64))).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="unreadable image_b64")
    w = max(256, min(1024, int(req.width))) // 32 * 32
    h = max(256, min(1024, int(req.height))) // 32 * 32
    src = src.resize((w, h), Image.LANCZOS)
    frames = min(161, max(9, int(req.frames)))
    frames = (frames - 1) // 8 * 8 + 1
    steps = max(5, min(60, int(req.steps)))
    seed = req.seed if req.seed >= 0 else int(time.time()) % 2**31
    gen = torch.Generator(device="mps" if torch.backends.mps.is_available() else "cpu").manual_seed(seed)
    t0 = time.time()
    with torch.inference_mode():
        out = i2v_pipe(
            image=src,
            prompt=req.prompt or "gentle motion, slow push-in",
            negative_prompt=req.negative_prompt,
            width=w,
            height=h,
            num_frames=frames,
            num_inference_steps=steps,
            guidance_scale=float(req.guidance),
            decode_timestep=0.05,
            decode_noise_scale=0.025,
            generator=gen,
        )
    mp4 = frames_to_mp4(out.frames[0], fps=max(8, min(30, int(req.fps))))
    ms = int((time.time() - t0) * 1000)
    if format == "mp4":
        return Response(content=mp4, media_type="video/mp4")
    return {
        "video_b64": base64.b64encode(mp4).decode(),
        "width": w, "height": h, "frames": frames,
        "fps": max(8, min(30, int(req.fps))), "seed": seed, "ms": ms,
    }


if __name__ == "__main__":
    import uvicorn

    load_pipe()
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
