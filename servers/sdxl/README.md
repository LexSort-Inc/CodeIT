# CodeIT local image servers (SDXL)

The Images tab talks to a **quality server on localhost** — same `/info` + `/generate`
contract on every machine. No keys, your hardware.

| Machine | Server | Backend |
|---|---|---|
| Mac | `server_sdxl_mac.py` → `http://127.0.0.1:8002` | Pony Diffusion V6 XL, MPS fp16 |
| ThinkCenter (Windows) | `server_sdxl_win.py` → `http://127.0.0.1:8002` | Pony Diffusion V6 XL, OpenVINO fp16 CPU |

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

## Windows setup (one time, ThinkCenter)

Prereqs (already on the ThinkCenter; one-time notes for a fresh box):
`ImageGen\Models\sdxl-ov` holds the Pony V6 XL OpenVINO fp16 export (~8GB),
`ImageGen\fastsd\env` the Python env (`torch`, `optimum-intel`, `openvino`,
`fastapi`, `uvicorn`, `pillow`). Model source: `stablediffusionapi/Pony-Diffusion-V6-XL`.

## Run (Windows)

CodeIT auto-starts this server on launch (Electron `imgservers`, port 8002).
Manual equivalent:

```powershell
$env:MODEL_DIR = "$env:USERPROFILE\ImageGen\Models\sdxl-ov"
$env:PORT = "8002"
& "$env:USERPROFILE\ImageGen\fastsd\env\Scripts\python.exe" servers\sdxl\server_sdxl_win.py
```

Then open CodeIT → right pane → **Images**. A 1024² render takes ~6 min
(8 steps) to ~17 min (28 steps) on the Ryzen 7 PRO 5750GE CPU.

## Keep-alive (launchd, Mac)

The server runs as a LaunchAgent so it survives shells and restarts itself:

- Plist: `~/Library/LaunchAgents/com.codeit.sdxl-mac.plist`
- Runs: `~/PonyServer/server_sdxl_mac.py` (**local SSD copy** of this repo file —
  launching Python with its script on the external vault stalls at startup
  when the drive sleeps; re-copy after editing: `cp servers/sdxl/server_sdxl_mac.py ~/PonyServer/`)
- Logs: `~/PonyServer/server.log`
- `launchctl load/unload ~/Library/LaunchAgents/com.codeit.sdxl-mac.plist`

## API

- `GET /info` → `{ model, backend, device, dtype, ready, error }`
- `POST /generate {prompt, negative_prompt?, width?, height?, steps?, guidance?, seed?}`
  → `{ image_b64, width, height, seed, ms }`, or PNG bytes with `?format=png`
