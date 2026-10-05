# Windows build on ThinkCenter (windowstcenter / 100.119.205.77 via Tailscale)

Mac (`npm run dev`) is done here. Windows `.exe` must be built on the ThinkCenter
(electron-builder Windows target needs Windows for code-sign/NSIS parity).

## Option A — build on ThinkCenter (recommended)

```powershell
# on ThinkCenter PowerShell:
git clone https://github.com/LexSort-Inc/CodeIT.git
cd CodeIT
npm install
ollama pull qwen2.5-coder:7b
npm run dist:win
# output: release\CodeIT-0.1.0-setup.exe
```

Requirements on ThinkCenter: Node 20+, Ollama for Windows, WebView2 (ships with Win11).

> Ollama headless note: the tray app can fail with "Unable to init instance" on
> AMD-iGPU boxes. Run the server directly instead — it works fine:
> `powershell -NoProfile -Command "Start-Process -FilePath ollama -ArgumentList 'serve' -WindowStyle Hidden"`
> If the iGPU still interferes: `setx OLLAMA_LLM_LIBRARY cpu`, then start serve.
> Models live in `%USERPROFILE%\.ollama` and survive reboots; just re-run serve.

## Option B — trigger from Mac over Tailscale (SSH)

```bash
ssh williamcommu@100.119.205.77  # or your Windows user; needs OpenSSH server enabled
cd CodeIT && git pull && npm install && npm run dist:win
scp williamcommu@100.119.205.77:~/CodeIT/release/CodeIT-*.exe ./release/
```

Enable OpenSSH on ThinkCenter once:
`Settings > System > Optional features > OpenSSH Server`, then `Start-Service sshd`.

## Verify parity

- [ ] `ollama list` shows qwen2.5-coder:7b
- [ ] Chat streams from Ollama (no key)
- [ ] Open folder + edit + save works (C:\Users\…)
- [ ] Terminal `dir` / `ollama list` runs with approval click
- [ ] Web dock tabs load (needs WebView2 login once)

## v0.2 upgrade (both machines)

`npm i node-pty xterm xterm-addon-fit` — needs VS Build Tools on Windows
(`winget install Microsoft.VisualStudio.2022.BuildTools`) + Xcode CLT on Mac.
