// System visibility: memory overview, top processes, guarded kill.
// Lets the user see what's eating RAM and shut things down from inside CodeIT.
// mac-first; Windows via tasklist (ThinkCenter verifies). Never touchable:
// kernel, init, login/session infra, ourselves, or model servers (use backends:*).
const os = require('os');
const { execFileSync, execFile } = require('child_process');

const NEVER_KILL = new Set([
  'kernel_task', 'launchd', 'WindowServer', 'loginwindow', 'logd',
  'CodeIT', 'Electron', 'CodeIT Helper',
]);

function getMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  const out = { total, free, used: total - free, usedPct: total ? free / total : 0, swapUsed: null, pressure: 'unknown' };
  if (process.platform === 'darwin') {
    try {
      const vm = execFileSync('vm_stat', { timeout: 5000 }).toString();
      const get = (k) => { const m = vm.match(new RegExp(k + ':\\s+([0-9]+)')); return m ? Number(m[1]) * 16384 : 0; };
      const wired = get('Pages wired down');
      const comp = get('Pages occupied by compressor');
      const swap = get('Swapins');
      // pressure heuristic: free+inactive+speculative vs total
      const reclaim = get('Pages free') + get('Pages inactive') + get('Pages speculative');
      const ratio = total ? reclaim / total : 0;
      out.pressure = ratio > 0.25 ? 'green' : ratio > 0.12 ? 'yellow' : 'red';
      out.wired = wired; out.compressed = comp; out.swapins = swap;
    } catch {}
  } else {
    const ratio = total ? free / total : 0;
    out.pressure = ratio > 0.25 ? 'green' : ratio > 0.12 ? 'yellow' : 'red';
  }
  return out;
}

function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 10000 }, (err, stdout) => {
        if (err) return resolve({ ok: false, error: String(err.message).slice(0, 200), procs: [] });
        const procs = [];
        for (const line of String(stdout).split('\n')) {
          const m = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([\d,]+) K"/);
          if (!m) continue;
          procs.push({ pid: Number(m[2]), name: m[1].replace(/\.exe$/i, ''), rssMB: Number(m[3].replace(/,/g, '')) / 1024 });
        }
        procs.sort((a, b) => b.rssMB - a.rssMB);
        resolve({ ok: true, procs: procs.slice(0, 25) });
      });
      return;
    }
    execFile('ps', ['-axo', 'pid=,rss=,comm=', '-r'], { timeout: 10000 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: String(err.message).slice(0, 200), procs: [] });
      const procs = [];
      for (const line of String(stdout).split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!m) continue;
        const rssMB = Number(m[2]) / 1024;
        if (rssMB < 50) continue; // noise floor
        const full = m[3];
        const name = full.split('/').pop().split(' ')[0];
        procs.push({ pid: Number(m[1]), name, rssMB: Math.round(rssMB), full: full.slice(0, 120) });
        if (procs.length >= 25) break;
      }
      resolve({ ok: true, procs });
    });
  });
}

function killProcess(pid) {
  pid = Number(pid);
  if (!pid || pid <= 1) return { ok: false, error: 'refusing: system pid' };
  if (pid === process.pid) return { ok: false, error: 'refusing: that is CodeIT itself' };
  try {
    process.kill(pid, 0); // existence + permission check
  } catch {
    return { ok: false, error: 'no permission for that process' };
  }
  // Resolve name for the deny list (best effort).
  try {
    const { execFileSync: sync } = require('child_process');
    let name = '';
    if (process.platform === 'win32') {
      const out = sync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeout: 5000 }).toString();
      const m = out.match(/^"([^"]+)"/);
      if (m) name = m[1].replace(/\.exe$/i, '');
    } else {
      name = sync('ps', ['-o', 'comm=', '-p', String(pid)], { timeout: 5000 }).toString().trim().split('/').pop();
    }
    const base = name.replace(/\s*\(.*\)$/, ''); // strip " (Renderer)" style suffixes
    for (const deny of NEVER_KILL) {
      if (base === deny || base.startsWith(deny + ' ')) {
        return { ok: false, error: `refusing: ${base} is protected (use its own quit/unload)` };
      }
    }
    if (/^(ollama|python)/i.test(base)) {
      return { ok: false, error: `refusing: ${base} is a model backend — unload it from the Backends section instead` };
    }
  } catch {
    return { ok: false, error: 'could not identify process — refusing' };
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    return { ok: false, error: String(err.message).slice(0, 200) };
  }
  return { ok: true };
}

module.exports = { getMemory, listProcesses, killProcess };
