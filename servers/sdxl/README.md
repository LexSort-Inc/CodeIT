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
16GB MPS. `Save to project` drops PNGs into `<project>/.codeit/images/`.

## API

- `GET /info` → `{ model, backend, device, dtype, ready, error }`
- `POST /generate {prompt, negative_prompt?, width?, height?, steps?, guidance?, seed?}`
  → `{ image_b64, width, height, seed, ms }`, or PNG bytes with `?format=png`
