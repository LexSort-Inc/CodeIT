# CodeIT local image servers (SDXL)

The Images tab talks to a **quality server on localhost** — same `/info` + `/generate`
contract on every machine. No keys, your hardware.

| Machine | Server | Backend |
|---|---|---|
| Mac (this one) | `server_sdxl_mac.py` → `http://127.0.0.1:8002` | Pony Diffusion V6 XL, MPS fp16 |
| ThinkCenter | Windows variant (same API, port 8002) | DirectML/CPU |

## Mac setup (one time)

```bash
python3.11 -m venv ~/PonyServer/.venv
~/PonyServer/.venv/bin/pip install torch transformers diffusers accelerate safetensors fastapi uvicorn pillow huggingface_hub
~/PonyServer/.venv/bin/hf download stablediffusionapi/Pony-Diffusion-V6-XL --local-dir ~/PonyServer/Models/pony-v6-xl
```

## Run

```bash
cd ~/PonyServer
MODEL_DIR=~/PonyServer/Models/pony-v6-xl PORT=8002 ./.venv/bin/python \
  "/Volumes/TOSHIBA EXT/JUST_ME_MEDIA_VAULT/02_ACTIVE_PROJECTS/CodeIT/servers/sdxl/server_sdxl_mac.py"
```

Then open CodeIT → right pane → **Images**. A 1024² render takes ~1–3 min on
16GB MPS. `Save to project` drops PNGs into `<project>/.codeit/images/>`.

## Mac tuning (16GB M1 Pro, Oct 2026)

- SDXL LaunchAgent sets `PYTORCH_MPS_HIGH_WATERMARK_RATIO=1.2` +
  `PYTORCH_MPS_LOW_WATERMARK_RATIO=1.0` (fail fast instead of swap-death;
  low must stay below high). The LTX video server does NOT set a watermark:
  its 2B + T5-XXL load legitimately needs ~14GB+ and trips any cap —
  instead it relies on one-resident-at-a-time discipline.
- Both set `PYTORCH_ENABLE_MPS_FALLBACK=1`.
- Ollama side (persistent `com.codeit.ollama-env` agent): `KEEP_ALIVE=30m`,
  `FLASH_ATTENTION=1`, `KV_CACHE_TYPE=q8_0`, `MAX_LOADED_MODELS=1`.
- Run one heavy resident at a time (Ollama XOR SDXL XOR LTX).

## Keep-alive (app-managed)

CodeIT starts this server on launch and kills it on quit (nothing resident
when the app is closed). The legacy `com.codeit.sdxl-mac` LaunchAgent is
disabled — do not re-enable it or you'll get double loads. Logs:
`~/PonyServer/sdxl.codeit.log`.

## API

- `GET /info` → `{ model, backend, device, dtype, ready, error }`
- `POST /generate {prompt, negative_prompt?, width?, height?, steps?, guidance?, seed?}`
  → `{ image_b64, width, height, seed, ms }`, or PNG bytes with `?format=png`
