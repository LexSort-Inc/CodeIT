// Backend lifecycle: heavy models load when CodeIT starts, unload when it quits.
// - Ollama: ensure :11434 answers; if not, spawn `ollama serve`. On quit,
//   best-effort `ollama stop` for resident models (server idles ~100MB).
// - SDXL :8002: spawned on launch (small enough to keep resident).
// - Video :8003: lazy via videos:ensure (first Videos-tab open), killed on quit.
// Children are plain (non-detached) subprocesses + explicitly killed on quit,
// so nothing survives the app. Windows lifecycle is owned by ThinkCenter
// (win/sdxl-server); there this manager only pings Ollama.

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

const children = new Map(); // name -> ChildProcess
const HOME = os.homedir();

function logPath(name) {
  const dir = path.join(HOME, 'PonyServer');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return path.join(dir, `${name}.codeit.log`);
}

async function portUp(port, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/tags`, { signal: ctrl.signal });
    return r.ok;
  } catch {
    try {
      const r2 = await fetch(`http://127.0.0.1:${port}/info`, { signal: ctrl.signal });
      return r2.ok;
    } catch { return false; }
  } finally { clearTimeout(t); }
}

function spawnLogged(name, cmd, args, env) {
  stopOne(name);
  const out = fs.openSync(logPath(name), 'a');
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.on('exit', () => { if (children.get(name) === child) children.delete(name); });
  children.set(name, child);
  return child;
}

function stopOne(name) {
  const c = children.get(name);
  if (!c || c.killed || c.exitCode != null) { children.delete(name); return; }
  try { c.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { if (c.exitCode == null) c.kill('SIGKILL'); } catch {} }, 4000);
  children.delete(name);
}

function pyServerSpec(which) {
  // Prefer the local SSD copy (external vault stalls Python startup when asleep).
  const local = path.join(HOME, 'PonyServer', which === 'video' ? 'server_video_mac.py' : 'server_sdxl_mac.py');
  const models = which === 'video' ? 'ltx-video' : 'pony-v6-xl';
  const port = which === 'video' ? '8003' : '8002';
  return {
    python: path.join(HOME, 'PonyServer', '.venv', 'bin', 'python'),
    script: local,
    env: {
      MODEL_DIR: path.join(HOME, 'PonyServer', 'Models', models),
      PORT: port,
      PYTORCH_ENABLE_MPS_FALLBACK: '1',
    },
    port: Number(port),
  };
}

async function ensureOllama() {
  if (await portUp(11434)) return { ok: true, started: false };
  if (process.platform === 'win32') return { ok: false, error: 'ollama not running (ThinkCenter owns startup)' };
  try {
    spawnLogged('ollama', 'ollama', ['serve'], {});
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await portUp(11434)) return { ok: true, started: true };
    }
    return { ok: false, error: 'ollama serve did not come up' };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 200) };
  }
}

function memHeadroomGB() {
  // Free + reclaimable (inactive/speculative) on darwin; -1 when unknown.
  try {
    if (process.platform !== 'darwin') return -1;
    const out = require('child_process').execFileSync('vm_stat', { timeout: 5000 }).toString();
    const get = (k) => { const m = out.match(new RegExp(k + ':\\s+([0-9]+)')); return m ? Number(m[1]) : 0; };
    const pages = get('Pages free') + get('Pages inactive') + get('Pages speculative');
    return (pages * 16384) / 1024 / 1024 / 1024;
  } catch { return -1; }
}

function otherGiantRunning(name) {
  const other = name === 'video' ? 'sdxl' : 'video';
  const c = children.get(other);
  if (c && !c.killed && c.exitCode == null) return other;
  return null;
}

// Boot set for the tab the user last had open: chat-side tabs need only
// Ollama; images adds SDXL; videos adds the video server (never both giants).
async function bootFor(tab) {
  const ollama = await ensureOllama();
  let extra = { ok: true, skipped: true };
  if (tab === 'images') extra = await ensureImage();
  else if (tab === 'videos') extra = await ensureVideo();
  return { ollama, extra };
}

// One-click switch: unload the other giant, start this one.
async function switchTo(target) {
  const other = target === 'video' ? 'sdxl' : 'video';
  stopOne(other);
  // Give the OS a breath to reclaim before the next giant loads.
  await new Promise((r) => setTimeout(r, 3000));
  return target === 'video' ? ensureVideo() : ensureImage();
}

async function ensureImage() {
  if (await portUp(8002)) return { ok: true, started: false };
  if (process.platform !== 'darwin') return { ok: false, error: 'managed externally on this platform' };
  // Never sabotage a running sibling: refuse with guidance instead of killing.
  // (Ollama stays — chat + one renderer fits 16GB.)
  if (otherGiantRunning('sdxl')) {
    return { ok: false, error: 'video server is running — stop it (Videos tab will idle it) before starting images' };
  }
  const s = pyServerSpec('sdxl');
  if (!fs.existsSync(s.python) || !fs.existsSync(s.script)) {
    return { ok: false, error: 'PonyServer venv/script missing — see servers/sdxl/README.md' };
  }
  spawnLogged('sdxl', s.python, ['-u', s.script], s.env);
  return { ok: true, started: true };
}

async function ensureVideo() {
  if (await portUp(8003)) return { ok: true, started: false };
  if (process.platform !== 'darwin') return { ok: false, error: 'managed externally on this platform' };
  if (otherGiantRunning('video')) {
    return { ok: false, error: 'image server is running — switch away from Images first to free RAM' };
  }
  const headroom = memHeadroomGB();
  if (headroom >= 0 && headroom < 6) {
    return { ok: false, error: `low memory (${headroom.toFixed(1)}GB free) — quit a heavy app and retry` };
  }
  const s = pyServerSpec('video');
  if (!fs.existsSync(s.python) || !fs.existsSync(s.script)) {
    return { ok: false, error: 'PonyServer venv/script missing — see servers/video/README.md' };
  }
  spawnLogged('video', s.python, ['-u', s.script], s.env);
  return { ok: true, started: true };
}

function stopBackends() {
  // Kill our Python servers + ollama serve (only if we started it).
  for (const name of [...children.keys()]) stopOne(name);
  // Best-effort: unload resident Ollama models so RAM frees on quit.
  try {
    const out = require('child_process').execFileSync('ollama', ['ps'], { timeout: 8000 }).toString();
    const names = out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)[0])
      .filter((n) => n && n !== 'NAME');
    for (const n of names.slice(0, 8)) {
      try { execFileSync('ollama', ['stop', n], { timeout: 30000 }); } catch {}
    }
  } catch {}
}

module.exports = { ensureOllama, ensureImage, ensureVideo, bootFor, switchTo, stopBackends, portUp };
