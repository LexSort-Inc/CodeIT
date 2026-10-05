# CodeIT — local-first AI workspace

Desktop workspace that brings **local LLMs (Ollama)** + **free cloud providers** + **terminal** + **webview dock** under one roof. No walled garden.

> v0.1 scaffold: Electron + Vite + React + Ollama (`qwen2.5-coder:7b` default) + Gemini/Groq/DeepSeek/OpenRouter router + file workspace + command runner + webview dock. Mac dev here, Windows build on ThinkCenter.

## Quick start (Mac)

```bash
cd "/Volumes/TOSHIBA EXT/JUST_ME_MEDIA_VAULT/02_ACTIVE_PROJECTS/CodeIT"
npm install
npm run dev        # vite + electron, needs Ollama running
ollama pull qwen2.5-coder:7b
ollama serve       # http://127.0.0.1:11434
```

Set free cloud keys (optional, stored locally only — never committed):

```bash
cp .env.example .env
# edit GEMINI_API_KEY= / GROQ_API_KEY= / DEEPSEEK_API_KEY= / OPENROUTER_API_KEY=
```

## Windows build (ThinkCenter via Tailscale)

```bash
# on ThinkCenter (windowstcenter / 100.119.205.77):
git clone https://github.com/LexSort-Inc/CodeIT.git
cd CodeIT
npm install
npm run dist:win   # outputs release/CodeIT-0.1.0-setup.exe
```

See `docs/WINDOWS-BUILD.md`.

## Projects — many repos, clean org

Left rail holds **projects**: add any local folder (`+ Folder`) or clone a GitHub repo (`+ GitHub`, lists your `gh` repos or paste `OWNER/REPO`, clones to `~/CodeIT-projects`). Switching projects switches files, terminal cwd, git branch badge, and chat history.

Per-project context (auto-attached to every chat in that project):
- **Pinned files** — Pin button in editor, shown as 📌 chips
- **Notes tab** — stack/conventions/goals, saved to `.codeit/CONTEXT.md` inside the project so it travels with the repo
- **Chat history** — stored per project (`userData/CodeIT/chats/<id>.json`), Clear button resets

Topbar shows `branch` + dirty count (`●n`) for git repos, Reveal opens Finder/Explorer.

```
electron/main.js      — BrowserWindow, IPC: fs list/read/write, exec cmd, LLM passthrough
electron/preload.js   — safe bridge (window.codeit.*)
src/llm/router.js     — unified chat(): ollama | gemini | groq | deepseek | openrouter
src/components/      — ChatPane, FileExplorer, EditorPane, TerminalPane, WebviewDock
```

Inspired by (not forked, MIT/Apache-safe): AnythingLLM router pattern, Jan model UX, Goose `goose run` headless, Open Interpreter approval flow.

## License

MIT — see LICENSE.
