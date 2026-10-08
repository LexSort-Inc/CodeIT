#!/usr/bin/env python3
"""CodeIT local image server — Pony Diffusion V6 XL (SDXL) on Windows.

OpenVINO fp16 (CPU) quality endpoint. Same contract as other CodeIT quality servers:
  GET  /info      -> { model, backend, device, dtype, ready, error }
  POST /generate  -> { image_b64, width, height, seed, ms }  (JSON) or PNG bytes (?format=png)
  GET  /progress  -> { running, step, total }  (extra; Images UI polls this, optional)

ThinkCenter ownership (see docs/WORKFLOW.md). Mirrors servers/sdxl/server_sdxl_mac.py
field-for-field; only backend/device/model-source differ.

Run:
  set MODEL_DIR=%USERPROFILE%\\ImageGen\\Models\\sdxl-ov
  %USERPROFILE%\\ImageGen\\fastsd\\env\\Scripts\\python.exe servers\\sdxl\\server_sdxl_win.py
CodeIT app talks to http://127.0.0.1:8002 directly (CORS open for localhost).
"""

import base64
import io
import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import torch

MODEL_DIR = os.path.expanduser(os.getenv("MODEL_DIR", r"~\ImageGen\Models\sdxl-ov"))
PORT = int(os.getenv("PORT", "8002"))
MODEL_ID = "stablediffusionapi/Pony-Diffusion-V6-XL"

app = FastAPI(title="CodeIT SDXL Windows")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

pipe = None
load_error = None
progress = {"running": False, "step": 0, "total": 0}


def load_pipe():
    global pipe, load_error
    if pipe is not None or load_error is not None:
        return
    try:
        from optimum.intel.openvino import OVStableDiffusionXLPipeline

        pipe = OVStableDiffusionXLPipeline.from_pretrained(MODEL_DIR, compile=True)
        print(f"[sdxl-win] loaded (openvino fp16 cpu) from {MODEL_DIR}", flush=True)
    except Exception as e:  # noqa: BLE001 — surfaced via /info
        load_error = str(e)[:500]
        print(f"[sdxl-win] load failed: {load_error}", flush=True)


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
        "backend": "openvino",
        "device": "cpu",
        "dtype": "fp16",
        "ready": pipe is not None,
        "error": load_error,
    }


@app.get("/progress")
def progress_endpoint():
    return progress


@app.post("/generate")
async def generate(req: GenReq, format: str = "json"):
    load_pipe()
    if pipe is None:
        raise HTTPException(status_code=503, detail=load_error or "model not loaded")
    w = max(256, min(1536, int(req.width)))
    h = max(256, min(1536, int(req.height)))
    steps = max(5, min(60, int(req.steps)))
    seed = req.seed if req.seed >= 0 else int(time.time()) % 2**31
    gen = torch.Generator().manual_seed(seed)
    t0 = time.time()
    # Pony V6 XL likes score tags; prepend a quality boilerplate.
    prompt = f"score_9, score_8_up, score_7_up, {req.prompt}"
    progress["running"] = True
    progress["step"] = 0
    progress["total"] = steps

    def _cb(pipe, step, timestep, cb_kwargs):
        progress["step"] = step + 1
        return cb_kwargs

    try:
        # Blocking pipeline runs in a worker thread so /info + /progress stay responsive.
        out = await run_in_threadpool(
            lambda: pipe(
                prompt=prompt,
                negative_prompt=req.negative_prompt,
                width=w,
                height=h,
                num_inference_steps=steps,
                guidance_scale=float(req.guidance),
                generator=gen,
                callback_on_step_end=_cb,
            )
        )
    finally:
        progress["running"] = False
    img = out.images[0]
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
