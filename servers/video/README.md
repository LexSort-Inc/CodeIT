# CodeIT local video server (LTX-Video)

Sibling of the SDXL image server — the image pipeline is untouched.
Same shape: localhost quality server, `/info` + `/generate`, no keys.

| Machine | Server | Backend |
|---|---|---|
| Mac (this one) | `server_video_mac.py` → `http://127.0.0.1:8003` | LTX-Video 2B, MPS fp16 |
| ThinkCenter | Windows variant (same API, port 8003) | TBD |

## Mac setup (one time)

```bash
# same venv as the image server, plus mp4 muxing:
~/PonyServer/.venv/bin/pip install imageio imageio-ffmpeg
~/PonyServer/.venv/bin/hf download Lightricks/LTX-Video --local-dir ~/PonyServer/Models/ltx-video
```

## Run

```bash
cd ~/PonyServer
MODEL_DIR=~/PonyServer/Models/ltx-video PORT=8003 ./.venv/bin/python \
  "/Volumes/TOSHIBA EXT/JUST_ME_MEDIA_VAULT/02_ACTIVE_PROJECTS/CodeIT/servers/video/server_video_mac.py"
```
Or: `launchctl load ~/Library/LaunchAgents/com.codeit.video-mac.plist`
(the plist is **manual-start only, no RunAtLoad**: the 2B+T5 load needs ~14GB
and must never auto-start alongside SDXL+Ollama on 16GB — Oct 2026 watchdog
panic. Start it when you want clips, unload when done.)

Or keep-alive via launchd: `~/Library/LaunchAgents/com.codeit.video-mac.plist`
(local SSD copy at `~/PonyServer/server_video_mac.py` — same external-drive
startup caveat as the image server; re-copy after editing).

Then CodeIT → right pane → **Videos**. A 2s clip takes ~3–8 min on 16GB MPS.
`Save` drops MP4s into `<project>/.codeit/videos/` (or `~/Downloads/CodeIT-videos/`).

## API

- `GET /info` → `{ model, backend, device, dtype, ready, error }`
- `POST /generate {prompt, negative_prompt?, width?, height?, frames?, fps?, steps?, guidance?, seed?}`
  → `{ video_b64, width, height, frames, fps, seed, ms }`, or raw MP4 with `?format=mp4`
- Frames snap to 8k+1 (25/49/97 ≈ 1s/2s/4s @24fps); spatial dims snap to ×32.
