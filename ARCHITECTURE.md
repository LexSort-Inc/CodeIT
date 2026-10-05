# CodeIT architecture (v0.1)

```
Electron main (electron/main.js)
  BrowserWindow + webviewTag + preload bridge
  IPC: workspace:open/root, fs:list/read/write, exec:run, llm:ping
Renderer (Vite + React, src/)
  ProjectsPane    — +Folder (dialog) / +GitHub (gh repo list + OWNER/REPO clone to ~/CodeIT-projects)
  ChatPane        — per-project history (userData chats), project notes + pinned file auto-context
  Settings      — provider/model picker + free-key inputs (localStorage only)
  FileExplorer  — fs:list (depth 3, skips dotfiles/node_modules)
  EditorPane    — fs:read/write, +File to chat (12k char cap for small models)
  TerminalPane  — exec:run with explicit Run click (approval gate)
  WebviewDock   — <webview partition="persist:webdock"> ChatGPT/Claude/Gemini web
```

Router fallback chain: `ollama (qwen2.5-coder:7b default) -> gemini-2.0-flash -> groq llama-3.3-70b -> openrouter :free`.
Keys in OS keychain via `keys:*` IPC (safeStorage); legacy localStorage keys migrate once, then cleared.

## Extensions (v0.2): skills + MCP tools

```
electron/catalog.js   — curated catalog (5 MCP + 4 skills) with localReady/cloudPreferred/needsKey/risk badges
electron/mcp.js       — MCP stdio client: spawn, initialize, tools/list, tools/call, kill on quit
electron/main.js      — tools:catalog/set-enabled/call/server-tools, skills:list, keys:get/set IPC
src/projects/context.js — skill keyword matching + system prompt builder (notes+pins+skills)
src/llm/router.js     — chatWithTools(): Ollama native /api/chat rounds (structured calls),
                        OpenAI-shape rounds for groq/deepseek/openrouter, streaming final answer.
                        Verified local tool-callers: qwen3:8b, mistral:7b. qwen2.5-coder:7b
                        emits pseudo-calls — warned, allowed, cloud suggested.
src/components/ExtensionsPane.jsx — curated store, per-project toggles
src/components/ToolApproval.jsx    — Allow once / Always / Deny gate (writes always prompt)
.agents/skills/*      — bundled skills (commit-helper, test-runner, project-notes, code-review)
AGENTS.md             — always-loaded repo instructions
```
