# CodeIT two-machine workflow (Mac + ThinkCenter)

Single source of truth: `origin/main`. It must always build green (CI enforces it).

## Branch rules

| Who | Prefix | Example |
|---|---|---|
| Mac (this machine) | `mac/` | `mac/signing`, `mac/sdxl-server` |
| ThinkCenter | `win/` | `win/directml-server`, `win/nsis` |
| Either, shared renderer | `feat/` | `feat/images-tab` |
| ThinkCenter sandbox | `rebuild` | (already exists — do not touch from Mac) |

- Work on a branch, push the branch, merge to `main` via PR (`gh pr create`).
- **Never force-push `main`** (branch protection blocks it). Rebase instead: `git pull --rebase`.
- `git add <paths>` — never blind `git add -A` (it sweeps other agents' files).
- One concern per commit; always `npm run build` before pushing.

## Ownership (who builds what, no overlap)

| Area | Owner |
|---|---|
| `servers/sdxl/server_sdxl_mac.py`, launchd, `.dmg`, Apple signing/notarize | Mac |
| Windows server variant, `setup-win.ps1`, `.exe`, DirectML/CPU notes | ThinkCenter |
| `src/`, `electron/` shared UI | Coordinate: branch + PR, other machine reviews |
| `servers/sdxl/README.md` contract (`/info` + `/generate` on :8002) | Shared, change by PR only |

## Before pushing to main

1. `git pull --rebase` (someone may have landed first — rebase, don't merge).
2. `npm run build` green.
3. Small commits; PR description says what + how verified.

## If a push is rejected

Someone landed first. `git pull --rebase`, resolve (theirs for unknown code, verify build), push again.
Never `--force` main. If truly stuck, stop and ask William.
