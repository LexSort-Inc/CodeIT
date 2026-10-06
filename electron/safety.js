// IPC boundary validation — pure functions, unit-tested in scripts/smoke/run.mjs.
// The renderer is our own UI, but every path/id/URL crossing into the main
// process gets checked here anyway: defense in depth against a compromised
// renderer (XSS via model output, stray webview, etc.).
const path = require('path');
const fsSync = require('fs');

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Is `p` inside `root` after normalization? Blocks `..` escapes and absolute
// paths that jump outside (path.join discards the base on absolute input).
function containedIn(root, p) {
  if (typeof p !== 'string' || !p || !root) return false;
  const base = path.resolve(root);
  const target = path.resolve(base, p);
  if (target === base) return true;
  return target.startsWith(base + path.sep);
}

// Chat ids become filenames (`chats/<id>.json`) — strict charset, no traversal.
function validChatId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !DANGEROUS_KEYS.has(id);
}

// Only http(s) may reach shell.openExternal — blocks file:, smb:, ms-settings:, javascript:.
function safeExternalUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

// Tool ids/keys/scopes become object keys in tools.json — same charset rules
// plus an explicit dangerous-key block (regex alone would allow `__proto__`).
function validToolId(id) {
  return typeof id === 'string' && /^[a-z][a-z0-9:_-]{0,63}$/.test(id) && !DANGEROUS_KEYS.has(id);
}

function validToolKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(key) && !DANGEROUS_KEYS.has(key);
}

function validScope(scope, knownProjectIds) {
  if (scope == null || scope === '' || scope === 'global') return true;
  if (typeof scope !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(scope)) return false;
  if (DANGEROUS_KEYS.has(scope)) return false;
  return knownProjectIds ? knownProjectIds.has(scope) : true;
}

// Secret names (provider ids) for keys.json.
function validKeyName(name) {
  return typeof name === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(name) && !DANGEROUS_KEYS.has(name);
}

function findOnPath(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { if (fsSync.statSync(p).isFile()) return p; } catch { /* keep looking */ }
  }
  return null;
}

// Windows CreateProcess cannot run .cmd shims (CVE-2024-27980), so resolve the
// real exe behind an npm shim instead of falling back to shell:true.
function resolveBin(bin) {
  if (process.platform !== 'win32') return bin;
  const direct = findOnPath(`${bin}.exe`);
  if (direct) return direct;
  const shim = findOnPath(`${bin}.cmd`);
  if (shim) {
    try {
      const m = fsSync.readFileSync(shim, 'utf8').match(/"([^"]+?\.exe)"/i);
      if (m) {
        const target = path.normalize(m[1].replace(/%dp0%/gi, path.dirname(shim) + path.sep));
        if (fsSync.existsSync(target)) return target;
      }
    } catch { /* fall through to honest spawn error */ }
  }
  return bin;
}

module.exports = { containedIn, validChatId, safeExternalUrl, validToolId, validToolKey, validScope, validKeyName, findOnPath, resolveBin };
