# CodeIT Windows setup — run once on ThinkCenter (PowerShell as user, no admin needed except Build Tools)
# Usage:  git clone https://github.com/LexSort-Inc/CodeIT.git; cd CodeIT; powershell -ExecutionPolicy Bypass -File scripts\setup-win.ps1

$ErrorActionPreference = 'Stop'
Write-Host '== CodeIT Windows setup ==' -ForegroundColor Cyan

# 1. Node check
try { $node = (node -v) } catch { Write-Host 'Install Node 20+ LTS from https://nodejs.org then re-run.' -ForegroundColor Red; exit 1 }
Write-Host "Node $node" -ForegroundColor Green

# 2. Ollama check
try { ollama list | Out-Null; Write-Host 'Ollama OK' -ForegroundColor Green }
catch { Write-Host 'Install Ollama for Windows from https://ollama.com/download then run: ollama pull qwen2.5-coder:7b' -ForegroundColor Yellow }

# 3. Pull model (best effort)
try { ollama pull qwen2.5-coder:7b } catch { Write-Host 'Skipping model pull (Ollama not running yet).' -ForegroundColor Yellow }

# 4. Deps + verify
npm install
npm run build

Write-Host ''
Write-Host 'Verified. To run dev:  npm run dev' -ForegroundColor Cyan
Write-Host 'To make installer: npm run dist:win  (output in release\*.exe)' -ForegroundColor Cyan
Write-Host 'Optional for full PTY terminal (v0.2): winget install Microsoft.VisualStudio.2022.BuildTools --silent'
