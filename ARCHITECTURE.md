# CodeIT architecture (v0.1)

```
Electron main (electron/main.js)
  BrowserWindow + webviewTag + preload bridge
  IPC: workspace:open/root, fs:list/read/write, exec:run, llm:ping
Renderer (Vite + React, src/)
  ChatPane      — streams via src/llm/router.js (Ollama OpenAI-compat SSE)
  Settings      — provider/model picker + free-key inputs (localStorage only)
  FileExplorer  — fs:list (depth 3, skips dotfiles/node_modules)
  EditorPane    — fs:read/write, +File to chat (12k char cap for small models)
  TerminalPane  — exec:run with explicit Run click (approval gate)
  WebviewDock   — <webview partition="persist:webdock"> ChatGPT/Claude/Gemini web
```

Router fallback chain: `ollama (qwen2.5-coder:7b default) -> gemini-2.0-flash -> groq llama-3.3-70b -> openrouter :free`.
Keys never leave machine. `.env` + localStorage only, `.gitignore` covers both.

Borrowed patterns (not vendored code): AnythingLLM provider map, Jan engine URL config,
Goose headless `goose run` (future agent), Open Interpreter y/n/e approval (mirrored in TerminalPane).
