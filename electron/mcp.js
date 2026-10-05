// Minimal MCP stdio client for Electron main process.
// Spawns `command args` per server, speaks JSON-RPC (initialize, tools/list, tools/call),
// keeps one process per server id, kills on app quit.
// Spec: 2026-07-28 — stdio + Streamable HTTP are the supported transports; we use stdio.

const { spawn } = require('child_process');

const SERVERS = new Map(); // id -> { proc, tools, pending, buf, seq }
const CALL_TIMEOUT = 60000;

function send(server, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.pending.delete(msg.id);
      reject(new Error(`MCP ${server.id}: request ${msg.method} timed out`));
    }, CALL_TIMEOUT);
    server.pending.set(msg.id, { resolve, reject, timer });
    server.proc.stdin.write(JSON.stringify(msg) + '\n');
  });
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
  // opts: { projectDir, env }
  const existing = SERVERS.get(entry.id);
  if (existing && !existing.proc.killed && existing.proc.exitCode == null) return existing;
  SERVERS.delete(entry.id);

  const args = (entry.args || []).map((a) => (a === '__PROJECT_DIR__' ? opts.projectDir : a));
  const env = { ...process.env, ...(opts.env || {}) };
  // resolve ${key:name} placeholders from safe key store passed in opts.keys
  for (const [k, v] of Object.entries(entry.env || {})) {
    env[k] = String(v).replace(/\$\{key:([\w-]+)\}/g, (_m, name) => (opts.keys && opts.keys[name]) || '');
  }

  const proc = spawn(entry.command, args, { cwd: opts.projectDir, env, stdio: ['pipe', 'pipe', 'ignore'] });
  const server = { id: entry.id, proc, tools: [], pending: new Map(), buf: '', seq: 1 };
  proc.stdout.on('data', (c) => onData(server, c));
  proc.on('exit', () => { SERVERS.delete(entry.id); });
  proc.on('error', () => { SERVERS.delete(entry.id); });
  SERVERS.set(entry.id, server);

  const nextId = () => server.seq++;
  await send(server, { jsonrpc: '2.0', id: nextId(), method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'CodeIT', version: '0.2.0' } } });
  await new Promise((resolve) => {
    try { server.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); } catch {}
    resolve();
  });
  const listed = await send(server, { jsonrpc: '2.0', id: nextId(), method: 'tools/list', params: {} });
  server.tools = (listed && listed.tools) || [];
  server.nextId = nextId;
  return server;
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
    try { s.proc.kill(); } catch {}
  }
  SERVERS.clear();
}

function isRunning(id) {
  const s = SERVERS.get(id);
  return Boolean(s && !s.proc.killed && s.proc.exitCode == null);
}

module.exports = { startServer, callTool, listTools, stopAll, isRunning };
