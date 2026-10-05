# CodeIT — agent instructions (repo root)

This file is always loaded for agentic work in this repo. Skills in `.agents/skills/` load on demand.

## Stack
- Electron 33 + Vite 6 + React 18. `electron/` is Node (CommonJS). `src/` is browser (ESM, no Node APIs — use `window.codeit` bridge).
- No TypeScript. No test framework yet — verify with `npm run build` + `node --check electron/*.js`.

## Commands
- `npm run dev` — Vite (5173) + Electron. Requires `ollama serve`.
- `npm run build` — production renderer bundle into `dist/`.
- `npm run dist:mac` / `npm run dist:win` — packaged installers into `release/`.
- Windows (ThinkCenter): `powershell -ExecutionPolicy Bypass -File scripts\setup-win.ps1`, then `npm run dist:win`.

## Conventions
- IPC handlers live in `electron/main.js`, exposed via `electron/preload.js` as `window.codeit.*`. Never enable `nodeIntegration`.
- Provider logic in `src/llm/router.js` (OpenAI-chat shaped). Ollama default model `qwen2.5-coder:7b`.
- Per-project state in main-process `projects.json`; per-project chat in `chats/<id>.json`; shared notes in `<project>/.codeit/CONTEXT.md`.
- Tools registry: `electron/catalog.js`. Secrets via `keys:*` IPC (safeStorage) — never localStorage, never log keys.
- Approval rule: read tools auto-approvable; write/exec tools always prompt (`Allow once / Always allow / Deny`).
