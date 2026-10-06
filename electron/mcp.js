// Minimal MCP stdio client for Electron main process.
// Spawns `command args` per server, speaks JSON-RPC (initialize, tools/list, tools/call),
// keeps one process per server id, kills on app quit.
// Spec: 2026-07-28 — stdio + Streamable HTTP are the supported transports; we use stdio.

const { spawn, execFile } = require('child_process');

const SERVERS = new Map(); // id -> { proc, tools, pending, buf, seq, starting, errBuf }
const CALL_TIMEOUT = 60000;

// Node refuses to spawn .cmd shims directly (CVE-2024-27980). Args come from the
// constant CATALOG plus the project dir — no free-form user input — so we build an
// explicitly quoted cmd.exe line instead of enabling shell:true on our own.
function spawnMcp(command, args, opts) {
  if (process.platform !== 'win32') return spawn(command, args, opts);
  const q = (a) => (/[ \t"]/.test(String(a)) ? `"${String(a).replace(/"/g, '""')}"` : String(a));
  const line = [command, ...args].map(q).join(' ');
  // windowsVerbatimArguments: we own the whole command line — libuv's \" escaping
  // would make cmd.exe look for a program literally called `npx -y ...`.
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
}

function send(server, msg) {
  return new Promise((resolve, reject) => {
    if (!server.proc || server.proc.killed || server.proc.exitCode != null) {
      reject(new Error(`MCP ${server.id}: server is not running`));
      return;
    }
    const timer = setTimeout(() => {
      server.pending.delete(msg.id);
      reject(new Error(`MCP ${server.id}: request ${msg.method} timed out`));
    }, CALL_TIMEOUT);
    server.pending.set(msg.id, { resolve, reject, timer });
    try {
      server.proc.stdin.write(JSON.stringify(msg) + '\n');
    } catch (err) {
      server.pending.delete(msg.id);
      clearTimeout(timer);
      reject(new Error(`MCP ${server.id}: write failed (${String((err && err.message) || err)})`));
    }
  });
}

// A dead server must fail fast, not leave requests hanging for 60s.
function failServer(server, reason) {
  const tail = server.errBuf ? ` — ${server.errBuf.slice(-400)}` : '';
  for (const [, p] of server.pending) {
    clearTimeout(p.timer);
    p.reject(new Error(`MCP ${server.id}: ${reason}${tail}`.slice(0, 900)));
  }
  server.pending.clear();
}

function onData(server, chunk) {
  server.buf += chunk.toString();
  const lines = server.buf.split('\n');
  server.buf = lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let msg;
    try { msg = JSON.parse(t); } catch { continue; } // ignore logging noise
    if (msg.id == null) continue; // notification
    const p = server.pending.get(msg.id);
    if (!p) continue;
    server.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`MCP ${server.id}: ${msg.error.message || JSON.stringify(msg.error)}`.slice(0, 500)));
    else p.resolve(msg.result);
  }
}

async function startServer(entry, opts) {
  // opts: { projectDir, env, keys }
  const existing = SERVERS.get(entry.id);
  if (existing) {
    // Concurrent callers during the handshake share the first start attempt —
    // previously the second caller hit a half-built server and failed oddly.
    if (existing.starting) return existing.starting;
    if (!existing.proc.killed && existing.proc.exitCode == null) return existing;
  }
  SERVERS.delete(entry.id);

  const args = (entry.args || []).map((a) => (a === '__PROJECT_DIR__' ? opts.projectDir : a));
  const env = { ...process.env, ...(opts.env || {}) };
  // resolve ${key:name} placeholders from safe key store passed in opts.keys
  for (const [k, v] of Object.entries(entry.env || {})) {
    env[k] = String(v).replace(/\$\{key:([\w-]+)\}/g, (_m, name) => (opts.keys && opts.keys[name]) || '');
  }

  let proc;
  try {
    proc = spawnMcp(entry.command, args, { cwd: opts.projectDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error(`MCP ${entry.id}: failed to spawn ${entry.command}: ${String((err && err.message) || err)}`);
  }
  const server = { id: entry.id, proc, tools: [], pending: new Map(), buf: '', seq: 1, errBuf: '', starting: null };
  proc.stdout.on('data', (c) => onData(server, c));
  proc.stderr.on('data', (c) => { server.errBuf = (server.errBuf + c.toString()).slice(-4000); });
  proc.stdin.on('error', () => { /* EPIPE — the exit handler reports the real reason */ });
  proc.on('exit', (code) => {
    SERVERS.delete(entry.id);
    failServer(server, `server exited (code ${code == null ? '?' : code})`);
  });
  proc.on('error', (err) => {
    SERVERS.delete(entry.id);
    failServer(server, `spawn failed: ${String((err && err.message) || err)}`);
  });
  SERVERS.set(entry.id, server);

  const nextId = () => server.seq++;
  const starting = (async () => {
    await send(server, { jsonrpc: '2.0', id: nextId(), method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'CodeIT', version: '0.2.0' } } });
    try { server.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } catch { /* dying server */ }
    const listed = await send(server, { jsonrpc: '2.0', id: nextId(), method: 'tools/list', params: {} });
    server.tools = (listed && listed.tools) || [];
    server.nextId = nextId;
    server.starting = null;
    return server;
  })();
  server.starting = starting;
  try {
    return await starting;
  } catch (err) {
    SERVERS.delete(entry.id);
    try { server.proc.kill(); } catch { /* already dead */ }
    throw err;
  }
}

async function callTool(entry, toolName, toolArgs, opts) {
  const server = await startServer(entry, opts);
  return send(server, { jsonrpc: '2.0', id: server.nextId(), method: 'tools/call', params: { name: toolName, arguments: toolArgs || {} } });
}

async function listTools(entry, opts) {
  const server = await startServer(entry, opts);
  return server.tools;
}

function stopAll() {
  for (const [, s] of SERVERS) {
    try {
      if (process.platform === 'win32' && s.proc.pid) {
        // kill() only hits the cmd.exe wrapper — take the whole tree down.
        execFile('taskkill', ['/PID', String(s.proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else s.proc.kill('SIGTERM');
    } catch { /* already gone */ }
  }
  SERVERS.clear();
}

function isRunning(id) {
  const s = SERVERS.get(id);
  return Boolean(s && !s.proc.killed && s.proc.exitCode == null);
}

module.exports = { startServer, callTool, listTools, stopAll, isRunning };
