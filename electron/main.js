const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const fsSync = require('fs');
const { exec, execFile } = require('child_process');
const { CATALOG } = require('./catalog');
const mcp = require('./mcp');
const { containedIn, validChatId, safeExternalUrl, validToolId, validToolKey, validScope, validKeyName, resolveBin } = require('./safety');

const isDev = !app.isPackaged;
let mainWindow;
let workspaceRoot = os.homedir();

// Defense in depth: only our own frame may call IPC. Webview guests never get
// this preload, and a navigated/compromised main frame must not reach us either.
{
  const realHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    realHandle(channel, (event, ...args) => {
      const url = (event && event.senderFrame && event.senderFrame.url) || '';
      const ok = !url || url.startsWith('file://') || url.startsWith('app://') ||
        url.startsWith('http://127.0.0.1:5173') || url.startsWith('http://localhost:5173');
      if (!ok) return Promise.reject(new Error(`blocked IPC from unexpected frame: ${String(url).slice(0, 120)}`));
      return listener(event, ...args);
    });
}

// File access is limited to the active workspace plus any project folder.
async function isAllowedPath(p) {
  if (!(typeof p === 'string' && p)) return false;
  const roots = [workspaceRoot];
  try {
    const data = await loadProjects();
    for (const proj of data.projects) if (proj && proj.path) roots.push(proj.path);
  } catch { /* store unreadable — workspace root alone */ }
  return roots.some((r) => containedIn(r, p));
}

// Windows CreateProcess cannot run .cmd shims (CVE-2024-27980); resolveBin in
// safety.js maps npm shims to their real exe instead of using shell:true.
let opencodeBin = null;
function getOpencodeBin() {
  if (!opencodeBin) opencodeBin = resolveBin('opencode');
  return opencodeBin;
}

// Kill a shell-spawned tree on Windows (cmd.exe → npx/node children).
function killTree(proc) {
  if (!proc) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
    } else proc.kill('SIGTERM');
  } catch { /* already gone */ }
}

// ---------- Projects store (organized multi-project workflow) ----------
// projects.json in userData: { activeId, projects: [{id,name,kind,path,repo,url,branch,pinned,createdAt,lastOpened}] }
// Per-project chat history: userData/chats/<id>.json
// Per-project notes: <project>/.codeit/CONTEXT.md (stays with the repo/folder)
function storeDir() {
  return path.join(app.getPath('userData'), 'CodeIT');
}
function projectsFile() {
  return path.join(storeDir(), 'projects.json');
}
function chatsDir() {
  return path.join(storeDir(), 'chats');
}
async function ensureStore() {
  await fs.mkdir(storeDir(), { recursive: true });
  await fs.mkdir(chatsDir(), { recursive: true });
  try {
    await fs.access(projectsFile());
  } catch {
    await fs.writeFile(projectsFile(), JSON.stringify({ activeId: null, projects: [] }, null, 2));
  }
}
async function loadProjects() {
  await ensureStore();
  try {
    const raw = await fs.readFile(projectsFile(), 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.projects)) data.projects = [];
    return data;
  } catch {
    return { activeId: null, projects: [] };
  }
}
async function saveProjects(data) {
  await ensureStore();
  await fs.writeFile(projectsFile(), JSON.stringify(data, null, 2));
}
function newId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
function deriveName(p) {
  return path.basename(p).replace(/[-_]+/g, ' ').trim() || p;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 950,
    title: 'CodeIT',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // needed for WebviewDock (ChatGPT/Claude free web tabs)
    }
  });

  if (isDev) {
    await mainWindow.loadURL('http://127.0.0.1:5173');
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // open external links in browser, not inside app (except webviews)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe);
    return { action: 'deny' };
  });

  // restore last active project as workspace root
  try {
    const data = await loadProjects();
    const active = data.projects.find((p) => p.id === data.activeId);
    if (active && fsSync.existsSync(active.path)) workspaceRoot = active.path;
  } catch { /* first run */ }
}

app.whenReady().then(createWindow).catch((err) => {
  try { dialog.showErrorBox('CodeIT failed to start', String((err && err.stack) || err).slice(0, 2000)); } catch { /* headless */ }
  app.quit();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => {});
});
process.on('unhandledRejection', (err) => {
  console.error('[codeit] unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[codeit] uncaughtException:', err);
});

// ---------- IPC: single workspace fs (now follows active project) ----------
ipcMain.handle('workspace:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!res.canceled && res.filePaths[0]) workspaceRoot = res.filePaths[0];
  return workspaceRoot;
});

async function listRecursive(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    const node = { name: e.name, path: full, type: e.isDirectory() ? 'dir' : 'file' };
    if (e.isDirectory() && depth < maxDepth) node.children = await listRecursive(full, depth + 1, maxDepth);
    out.push(node);
    if (out.length > 300) break;
  }
  return out;
}

ipcMain.handle('fs:list', async () => {
  try {
    return { root: workspaceRoot, tree: await listRecursive(workspaceRoot) };
  } catch (err) {
    return { root: workspaceRoot, tree: [], error: String(err) };
  }
});

ipcMain.handle('fs:read', async (_e, filePath) => {
  if (!(await isAllowedPath(filePath))) throw new Error('read denied: path is outside the open projects');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.slice(0, 200000); // 200k guard for small local models
  } catch (err) {
    throw new Error(`read failed: ${String((err && err.message) || err)}`);
  }
});

ipcMain.handle('fs:write', async (_e, filePath, content) => {
  if (!(await isAllowedPath(filePath))) throw new Error('write denied: path is outside the open projects');
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, String(content ?? ''), 'utf8');
    return true;
  } catch (err) {
    throw new Error(`write failed: ${String((err && err.message) || err)}`);
  }
});

// ---------- IPC: command runner (no native node-pty in v0.1; child_process, cross-platform) ----------
ipcMain.handle('exec:run', async (_e, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, { cwd: workspaceRoot, timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout).slice(0, 20000), stderr: String(stderr).slice(0, 20000) });
    });
  });
});

// ---------- IPC: background tasks (spawn-based, polled tail, killable) ----------
// Long commands (docker build, npm install, test suites) outlive chat navigation.
const { spawn } = require('child_process');
const TASKS = new Map();
let taskSeq = 0;
function taskSnapshot(t) {
  return { id: t.id, cmd: t.cmd, running: t.running, code: t.code, startedAt: t.startedAt, ms: Date.now() - t.startedAt };
}
ipcMain.handle('tasks:start', async (_e, cmd) => {
  const id = `task_${Date.now().toString(36)}_${(taskSeq++).toString(36)}`;
  const t = { id, cmd: String(cmd || ''), out: '', running: true, code: null, startedAt: Date.now(), proc: null };
  try {
    const shell = process.platform === 'win32';
    const proc = spawn(t.cmd, { cwd: workspaceRoot, shell, windowsHide: true });
    t.proc = proc;
    proc.stdout.on('data', (d) => { t.out = (t.out + d.toString()).slice(-200000); });
    proc.stderr.on('data', (d) => { t.out = (t.out + d.toString()).slice(-200000); });
    proc.on('close', (code) => { t.running = false; t.code = code; });
    proc.on('error', (err) => { t.running = false; t.code = 1; t.out += `\n[spawn error] ${String(err.message).slice(0, 500)}`; });
  } catch (err) {
    t.running = false; t.code = 1; t.out = `[spawn error] ${String(err.message).slice(0, 500)}`;
  }
  TASKS.set(id, t);
  // Evict only finished tasks; never kill a running job to make room. If all 20
  // slots are running, refuse honestly instead of silently dropping the oldest.
  if (TASKS.size >= 20) {
    const finished = [...TASKS.values()].find((x) => !x.running);
    if (finished) TASKS.delete(finished.id);
    else {
      TASKS.delete(id);
      return { id: null, cmd: t.cmd, error: 'Too many running tasks (20) — kill one in the Tasks tab, then retry.' };
    }
  }
  return { id, cmd: t.cmd };
});
ipcMain.handle('tasks:list', async () => [...TASKS.values()].map(taskSnapshot).reverse());
ipcMain.handle('tasks:tail', async (_e, id) => {
  const t = TASKS.get(id);
  if (!t) return { ok: false, out: '' };
  return { ok: true, out: t.out.slice(-20000), running: t.running };
});
ipcMain.handle('tasks:kill', async (_e, id) => {
  const t = TASKS.get(id);
  if (!t) return { ok: false };
  killTree(t.proc);
  setTimeout(() => { try { if (t.running) t.proc?.kill('SIGKILL'); } catch {} }, 3000);
  return { ok: true };
});

// ---------- IPC: OpenCode agent (non-interactive run in project dir, killable) ----------
const opencodeProcs = new Map(); // dir -> ChildProcess
ipcMain.handle('opencode:run', async (_e, dir, model, prompt) => {
  const promptText = String(prompt || '').slice(0, 100000);
  if (!promptText.trim()) return { ok: false, error: 'empty prompt' };
  if (dir && !(await isAllowedPath(dir))) return { ok: false, error: 'opencode dir is outside the open projects' };
  const args = ['run', promptText];
  if (dir) args.push('--dir', String(dir));
  if (model && model !== 'default') args.push('-m', String(model));
  const key = String(dir || 'default');
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let child = null;
    try {
      child = execFile(getOpencodeBin(), args, { cwd: dir || os.homedir(), timeout: 300000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (opencodeProcs.get(key) === child) opencodeProcs.delete(key);
        const out = String(stdout || '').slice(0, 20000);
        // A failed run must never look successful (SSE error frames proved this bug).
        if (error) done({ ok: false, error: String(stderr || error.message || 'opencode failed').slice(0, 2000), out });
        else done({ ok: true, out });
      });
      opencodeProcs.set(key, child);
      child.on('error', (err) => {
        if (opencodeProcs.get(key) === child) opencodeProcs.delete(key);
        done({ ok: false, error: `opencode failed to start: ${String(err && err.message || err).slice(0, 500)}` });
      });
    } catch (err) {
      done({ ok: false, error: String(err.message || err).slice(0, 500) });
    }
  });
});
ipcMain.handle('opencode:cancel', async (_e, dir) => {
  const child = opencodeProcs.get(String(dir || 'default'));
  if (!child) return { ok: false };
  killTree(child);
  setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
  return { ok: true };
});

// ---------- Renderer diagnostics: store paths ----------
ipcMain.handle('app:paths', async () => ({ userData: app.getPath('userData'), store: storeDir() }));

// ---------- IPC: projects ----------
ipcMain.handle('projects:list', async () => {
  const data = await loadProjects();
  return data;
});

ipcMain.handle('projects:add-local', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = res.filePaths[0];
  const data = await loadProjects();
  const existing = data.projects.find((p) => p.path === dir);
  if (existing) {
    data.activeId = existing.id;
    existing.lastOpened = new Date().toISOString();
    workspaceRoot = dir;
    await saveProjects(data);
    return { data, project: existing };
  }
  const project = { id: newId(), name: deriveName(dir), kind: 'local', path: dir, repo: null, url: null, pinned: [], createdAt: new Date().toISOString(), lastOpened: new Date().toISOString() };
  data.projects.unshift(project);
  data.activeId = project.id;
  workspaceRoot = dir;
  await saveProjects(data);
  return { data, project };
});

ipcMain.handle('projects:activate', async (_e, id) => {
  const data = await loadProjects();
  const p = data.projects.find((x) => x.id === id);
  if (!p) return null;
  data.activeId = id;
  p.lastOpened = new Date().toISOString();
  if (fsSync.existsSync(p.path)) workspaceRoot = p.path;
  await saveProjects(data);
  return { data, project: p, root: workspaceRoot };
});

ipcMain.handle('projects:remove', async (_e, id) => {
  const data = await loadProjects();
  data.projects = data.projects.filter((x) => x.id !== id);
  if (data.activeId === id) data.activeId = data.projects[0]?.id ?? null;
  await saveProjects(data);
  if (validChatId(id)) try { await fs.unlink(path.join(chatsDir(), `${id}.json`)); } catch { /* no chat yet */ }
  return data;
});

// ---------- Fresh start: wipe projects, chats, usage. Keys are kept (credentials).
ipcMain.handle('app:reset-data', async () => {
  await ensureStore();
  await saveProjects({ activeId: null, projects: [] });
  try {
    const files = await fs.readdir(chatsDir());
    for (const f of files) if (f.endsWith('.json')) await fs.unlink(path.join(chatsDir(), f)).catch(() => {});
  } catch {}
  try { await fs.unlink(usageFile()); } catch {}
  return true;
});

ipcMain.handle('projects:rename', async (_e, id, name) => {
  const data = await loadProjects();
  const p = data.projects.find((x) => x.id === id);
  if (p && name.trim()) p.name = name.trim();
  await saveProjects(data);
  return data;
});

ipcMain.handle('projects:pin', async (_e, id, filePath) => {
  const data = await loadProjects();
  const p = data.projects.find((x) => x.id === id);
  if (!p || typeof filePath !== 'string' || !filePath) return data;
  p.pinned = p.pinned || [];
  if (!p.pinned.includes(filePath)) p.pinned.push(filePath);
  await saveProjects(data);
  return data;
});

ipcMain.handle('projects:unpin', async (_e, id, filePath) => {
  const data = await loadProjects();
  const p = data.projects.find((x) => x.id === id);
  if (p) p.pinned = (p.pinned || []).filter((x) => x !== filePath);
  await saveProjects(data);
  return data;
});

ipcMain.handle('projects:reveal', async (_e, targetPath) => {
  const target = typeof targetPath === 'string' && targetPath ? targetPath : workspaceRoot;
  if (await isAllowedPath(target)) shell.showItemInFolder(target);
  return true;
});

// Per-project chat history (survives folder moves; stored in userData)
ipcMain.handle('projects:get-chat', async (_e, id) => {
  if (!validChatId(id)) return [];
  try {
    const raw = await fs.readFile(path.join(chatsDir(), `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
});
ipcMain.handle('projects:save-chat', async (_e, id, msgs) => {
  if (!validChatId(id)) return false;
  await ensureStore();
  // msgs: legacy array, or { threads: [{ id, provider, model, msgs }] }
  let payload = msgs;
  if (payload && typeof payload === 'object' && Array.isArray(payload.threads)) {
    payload = { threads: payload.threads.slice(0, 4).map((t) => ({ ...t, msgs: (t.msgs || []).slice(-100) })) };
  } else {
    payload = (Array.isArray(payload) ? payload : []).slice(-100);
  }
  await fs.writeFile(path.join(chatsDir(), `${id}.json`), JSON.stringify(payload, null, 2));
  return true;
});

// ---------- Usage metering: time + tokens + cost per call (userData/usage.json) ----------
function usageFile() {
  return path.join(storeDir(), 'usage.json');
}
async function loadUsage() {
  try {
    const raw = await fs.readFile(usageFile(), 'utf8');
    const d = JSON.parse(raw);
    if (Array.isArray(d.events)) return d;
  } catch { /* first run */ }
  return { events: [] };
}
// Parallel threads record usage at once — queue the whole read-modify-write so
// concurrent events don't overwrite each other, and allowlist event fields
// (renderer-controlled object never spreads raw into disk).
let usageChain = Promise.resolve();
ipcMain.handle('usage:record', async (_e, ev) => {
  const run = usageChain.then(async () => {
    await ensureStore();
    const d = await loadUsage();
    const src = ev && typeof ev === 'object' ? ev : {};
    d.events.push({
      t: new Date().toISOString(),
      projectId: typeof src.projectId === 'string' ? src.projectId.slice(0, 64) : null,
      provider: typeof src.provider === 'string' ? src.provider.slice(0, 64) : null,
      model: typeof src.model === 'string' ? src.model.slice(0, 120) : null,
      ms: Number(src.ms) || 0,
      prompt: Number(src.prompt) || 0,
      completion: Number(src.completion) || 0,
      ok: !!src.ok
    });
    await fs.writeFile(usageFile(), JSON.stringify({ events: d.events.slice(-2000) }, null, 2));
    return true;
  });
  usageChain = run.catch(() => {});
  return run;
});
ipcMain.handle('usage:get', async () => {
  const d = await loadUsage();
  const byKey = {};
  for (const e of d.events) {
    const k = `${e.provider || '?'}|${e.model || '?'}`;
    const b = byKey[k] || (byKey[k] = { provider: e.provider, model: e.model, calls: 0, okCalls: 0, prompt: 0, completion: 0, ms: 0 });
    b.calls += 1;
    if (e.ok) b.okCalls += 1;
    b.prompt += e.prompt || 0;
    b.completion += e.completion || 0;
    b.ms += e.ms || 0;
  }
  return { events: d.events.slice(-100), byKey, total: d.events.length };
});
ipcMain.handle('usage:reset', async () => {
  await ensureStore();
  await fs.writeFile(usageFile(), JSON.stringify({ events: [] }, null, 2));
  return true;
});

// ---------- Global chat search across all projects ----------
ipcMain.handle('chats:search', async (_e, q) => {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return [];
  const data = await loadProjects().catch(() => ({ projects: [] }));
  const names = Object.fromEntries((data.projects || []).map((p) => [p.id, p.name]));
  let files = [];
  try { files = await fs.readdir(chatsDir()); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const pid = f.slice(0, -5);
    let parsed = null;
    try { parsed = JSON.parse(await fs.readFile(path.join(chatsDir(), f), 'utf8')); } catch { continue; }
    const list = Array.isArray(parsed?.threads) ? parsed.threads
      : Array.isArray(parsed) && parsed.length ? [{ id: 'legacy', provider: '?', model: '?', title: 'Chat history', updatedAt: null, archived: false, msgs: parsed }] : [];
    for (const t of list) {
      const hay = `${t.title || ''} ${t.provider || ''} ${t.model || ''}`.toLowerCase();
      let snippet = null;
      if (hay.includes(query)) snippet = t.title || `${t.provider}/${t.model}`;
      else {
        const hit = (t.msgs || []).find((m) => String(m.content || '').toLowerCase().includes(query));
        if (hit) {
          const c = String(hit.content);
          const i = c.toLowerCase().indexOf(query);
          snippet = (i > 40 ? '…' : '') + c.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ');
        }
      }
      if (snippet) {
        out.push({ projectId: pid, projectName: names[pid] || pid, threadId: t.id, title: t.title || 'Chat history', provider: t.provider, model: t.model, updatedAt: t.updatedAt || null, archived: !!t.archived, snippet: String(snippet).slice(0, 160) });
      }
    }
    if (out.length >= 60) break;
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out.slice(0, 30);
});

// ---------- Build stamp: which commit is this packaged app built from? ----------
ipcMain.handle('app:buildinfo', async () => {
  try {
    const raw = await fs.readFile(path.join(__dirname, '..', 'dist', 'build-info.json'), 'utf8');
    return { ...JSON.parse(raw), version: app.getVersion() };
  } catch {
    return { commit: 'dev', date: null, version: app.getVersion() };
  }
});

// ---------- IPC: git info for active project ----------
function sh(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 15000 }, (error, stdout) => {
      resolve(error ? '' : String(stdout).trim());
    });
  });
}
ipcMain.handle('git:info', async () => {
  const branch = await sh('git branch --show-current', workspaceRoot);
  const status = await sh('git status --porcelain', workspaceRoot);
  const remote = await sh('git remote get-url origin', workspaceRoot);
  return { branch, dirty: status ? status.split('\n').length : 0, remote, isRepo: Boolean(branch || remote) };
});

// ---------- IPC: GitHub via gh CLI (already authed on this machine) ----------
function runBin(bin, args, cwd) {
  return new Promise((resolve) => {
    execFile(bin, args, { cwd: cwd || os.homedir(), timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) resolve({ ok: false, error: String(stderr || error.message).slice(0, 2000) });
      else resolve({ ok: true, out: String(stdout) });
    });
  });
}
ipcMain.handle('github:repos', async (_e, limit) => {
  const max = Number(limit) || 50;
  const perOwner = String(Math.min(Math.max(max, 10), 100));
  const fields = 'nameWithOwner,url,isPrivate,updatedAt';
  const all = [];
  const seen = new Set();
  const push = (arr) => {
    for (const r of Array.isArray(arr) ? arr : []) {
      if (r && r.nameWithOwner && !seen.has(r.nameWithOwner)) { seen.add(r.nameWithOwner); all.push(r); }
    }
  };
  const personal = await runBin('gh', ['repo', 'list', '--limit', perOwner, '--json', fields]);
  if (!personal.ok) return { ok: false, error: personal.error, repos: [] };
  try { push(JSON.parse(personal.out)); } catch (err) { return { ok: false, error: String(err), repos: [] }; }
  const orgs = await runBin('gh', ['api', 'user/orgs', '--paginate', '-q', '.[].login']);
  if (orgs.ok) {
    const logins = String(orgs.out || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    for (const org of [...new Set(logins)].slice(0, 20)) {
      const r = await runBin('gh', ['repo', 'list', org, '--limit', perOwner, '--json', fields]);
      if (!r.ok) continue;
      try { push(JSON.parse(r.out)); } catch { /* skip bad owner payload */ }
    }
  }
  all.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { ok: true, repos: all.slice(0, max) };
});
ipcMain.handle('projects:clone', async (_e, repoFullName, parentDir) => {
  const clean = String(repoFullName || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean)) return { ok: false, error: 'Use OWNER/REPO format, e.g. owner/repo' };
  let base = parentDir;
  if (!base) {
    base = path.join(os.homedir(), 'CodeIT-projects');
    await fs.mkdir(base, { recursive: true });
  }
  const dest = path.join(base, clean.split('/')[1]);
  if (fsSync.existsSync(dest)) return { ok: false, error: `Folder already exists: ${dest}` };
  // Prefer gh (handles auth) then fall back to git https
  let r = await runBin('gh', ['repo', 'clone', clean, dest]);
  if (!r.ok) {
    r = await runBin('git', ['clone', `https://github.com/${clean}.git`, dest]);
    if (!r.ok) return { ok: false, error: r.error };
  }
  const data = await loadProjects();
  const project = { id: newId(), name: clean.split('/')[1], kind: 'github', path: dest, repo: clean, url: `https://github.com/${clean}`, pinned: [], createdAt: new Date().toISOString(), lastOpened: new Date().toISOString() };
  data.projects.unshift(project);
  data.activeId = project.id;
  workspaceRoot = dest;
  await saveProjects(data);
  return { ok: true, data, project };
});

// ---------- IPC: secrets via safeStorage (OS keychain; never localStorage) ----------
function keysFile() {
  return path.join(storeDir(), 'keys.json');
}
async function readKeys() {
  try {
    const raw = await fs.readFile(keysFile(), 'utf8');
    const stored = JSON.parse(raw);
    const out = {};
    for (const [k, v] of Object.entries(stored)) {
      if (v && v.encrypted && safeStorage.isEncryptionAvailable()) {
        try { out[k] = safeStorage.decryptString(Buffer.from(v.data, 'base64')); } catch { out[k] = ''; }
      } else out[k] = v && v.data ? v.data : '';
    }
    return out;
  } catch { return {}; }
}
ipcMain.handle('keys:get', async () => readKeys());
ipcMain.handle('keys:set', async (_e, name, value) => {
  if (!validKeyName(name)) return { ok: false, error: 'invalid key name' };
  await ensureStore();
  let stored = {};
  try { stored = JSON.parse(await fs.readFile(keysFile(), 'utf8')); } catch {}
  if (value) {
    stored[name] = safeStorage.isEncryptionAvailable()
      ? { encrypted: true, data: safeStorage.encryptString(String(value)).toString('base64') }
      : { encrypted: false, data: String(value) };
  } else delete stored[name];
  await fs.writeFile(keysFile(), JSON.stringify(stored, null, 2));
  // migrate legacy renderer localStorage keys on next load (renderer clears them after)
  return { ok: true, encrypted: safeStorage.isEncryptionAvailable() };
});

// ---------- IPC: tools registry (curated catalog + per-project enablement) ----------
function toolsFile() {
  return path.join(storeDir(), 'tools.json');
}
async function loadToolState() {
  try {
    return JSON.parse(await fs.readFile(toolsFile(), 'utf8'));
  } catch {
    // defaults: skills on, safe MCP on, key-gated MCP off until key present
    return { enabled: { 'skill:commit-helper': true, 'skill:test-runner': true, 'skill:project-notes': true, 'skill:code-review': true, 'mcp:memory': true, 'mcp:sequentialthinking': true, 'mcp:context7': true }, alwaysAllow: [], projectOverrides: {} };
  }
}
async function saveToolState(s) {
  await ensureStore();
  await fs.writeFile(toolsFile(), JSON.stringify(s, null, 2));
}
function projectToolEnabled(state, projectId, toolId) {
  const over = projectId && state.projectOverrides && state.projectOverrides[projectId];
  if (over && toolId in over) return over[toolId];
  return state.enabled[toolId] === true;
}
ipcMain.handle('tools:catalog', async () => {
  const state = await loadToolState();
  const data = await loadProjects();
  const activeId = data.activeId;
  return CATALOG.map((c) => ({ ...c, enabled: projectToolEnabled(state, activeId, c.id) }));
});
ipcMain.handle('tools:set-enabled', async (_e, toolId, enabled, scope) => {
  if (!validToolId(toolId)) return { ok: false, error: 'invalid tool id' };
  const data = await loadProjects();
  const known = new Set(data.projects.map((p) => p.id));
  if (!validScope(scope, known)) return { ok: false, error: 'invalid scope' };
  const state = await loadToolState();
  if (scope && scope !== 'global') {
    if (!state.projectOverrides || typeof state.projectOverrides !== 'object') state.projectOverrides = {};
    if (!state.projectOverrides[scope] || typeof state.projectOverrides[scope] !== 'object') state.projectOverrides[scope] = {};
    state.projectOverrides[scope][toolId] = !!enabled;
  } else state.enabled[toolId] = !!enabled;
  await saveToolState(state);
  return { ok: true };
});
ipcMain.handle('tools:always-allow', async (_e, toolKey) => {
  if (!validToolKey(toolKey)) return { ok: false, error: 'invalid tool key' };
  const state = await loadToolState();
  if (!state.alwaysAllow.includes(toolKey)) state.alwaysAllow.push(toolKey);
  await saveToolState(state);
  return { ok: true };
});

// ---------- IPC: skills (markdown loader — project, repo, global) ----------
function parseSkillFrontmatter(text) {
  const m = String(text).match(/^---\n([\s\S]*?)\n---/);
  const out = { name: '', description: '' };
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k === 'name' || k === 'description') out[k] = v;
  }
  return out;
}
async function readSkillsFrom(dir) {
  const found = [];
  let entries = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return found; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const fp = path.join(dir, e.name, 'SKILL.md');
    try {
      const text = await fs.readFile(fp, 'utf8');
      const fm = parseSkillFrontmatter(text);
      if (fm.name) found.push({ id: `skill:${fm.name}`, name: fm.name, description: fm.description, body: text.slice(0, 6000), source: dir });
    } catch {}
  }
  return found;
}
ipcMain.handle('skills:list', async () => {
  const skills = [];
  // 1. active project .codeit/skills (user's own, travels with repo)
  if (workspaceRoot) skills.push(...await readSkillsFrom(path.join(workspaceRoot, '.codeit', 'skills')));
  // 2. CodeIT repo bundled skills (dev of CodeIT itself)
  skills.push(...await readSkillsFrom(path.join(__dirname, '..', '.agents', 'skills')));
  // 3. global user skills
  skills.push(...await readSkillsFrom(path.join(os.homedir(), '.codeit', 'skills')));
  const seen = new Set();
  return skills.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
});

// ---------- IPC: MCP tool calls (approval-gated) ----------
// Renderer flow: tools:call without approved -> write-risk returns {needsApproval}
// dialog result Allow once -> recall with approved:'once'; Always -> tools:always-allow then recall.
ipcMain.handle('tools:call', async (_e, serverId, toolName, toolArgs, approved) => {
  const entry = CATALOG.find((c) => c.id === serverId && c.kind === 'mcp');
  if (!entry) return { ok: false, error: `Unknown tool server ${serverId}` };
  if (typeof toolName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(toolName)) return { ok: false, error: 'invalid tool name' };
  const state = await loadToolState();
  const data = await loadProjects();
  if (!projectToolEnabled(state, data.activeId, serverId)) {
    return { ok: false, error: 'Tool server is disabled for this project — enable it in the Extensions tab.' };
  }
  const toolKey = `${serverId}.${toolName}`;
  const autoOk = entry.risk === 'read' || (approved === 'once') || state.alwaysAllow.includes(toolKey);
  if (!autoOk) {
    return { ok: false, needsApproval: true, serverId, toolName, toolArgs, risk: entry.risk };
  }
  const args = toolArgs && typeof toolArgs === 'object' && !Array.isArray(toolArgs) ? toolArgs : {};
  const keys = await readKeys();
  try {
    const result = await mcp.callTool(entry, toolName, args, { projectDir: workspaceRoot, keys });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 2000) };
  }
});
ipcMain.handle('tools:server-tools', async (_e, serverId) => {
  const entry = CATALOG.find((c) => c.id === serverId && c.kind === 'mcp');
  if (!entry) return { ok: false, error: 'unknown server', tools: [] };
  const state = await loadToolState();
  const data = await loadProjects();
  if (!projectToolEnabled(state, data.activeId, serverId)) return { ok: false, error: 'server disabled for this project', tools: [] };
  const keys = await readKeys();
  if (entry.needsKey && !keys[entry.needsKey]) return { ok: false, error: `missing key: ${entry.needsKey}`, tools: [] };
  try {
    const tools = await mcp.listTools(entry, { projectDir: workspaceRoot, keys });
    return { ok: true, tools: tools.map((t) => ({ name: t.name, description: (t.description || '').slice(0, 300), inputSchema: t.inputSchema })) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 1000), tools: [] };
  }
});

app.on('before-quit', () => {
  // No orphaned children: MCP servers, background tasks, opencode runs.
  mcp.stopAll();
  for (const t of TASKS.values()) if (t.running) killTree(t.proc);
  for (const c of opencodeProcs.values()) killTree(c);
  opencodeProcs.clear();
});
