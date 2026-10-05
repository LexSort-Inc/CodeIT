const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const fsSync = require('fs');
const { exec, execFile } = require('child_process');
const { CATALOG } = require('./catalog');
const mcp = require('./mcp');

const isDev = !app.isPackaged;
let mainWindow;
let workspaceRoot = os.homedir();

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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // restore last active project as workspace root
  try {
    const data = await loadProjects();
    const active = data.projects.find((p) => p.id === data.activeId);
    if (active && fsSync.existsSync(active.path)) workspaceRoot = active.path;
  } catch { /* first run */ }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- IPC: single workspace fs (now follows active project) ----------
ipcMain.handle('workspace:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!res.canceled && res.filePaths[0]) workspaceRoot = res.filePaths[0];
  return workspaceRoot;
});

ipcMain.handle('workspace:root', () => workspaceRoot);

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
  const content = await fs.readFile(filePath, 'utf8');
  return content.slice(0, 200000); // 200k guard for small local models
});

ipcMain.handle('fs:write', async (_e, filePath, content) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

// ---------- IPC: command runner (no native node-pty in v0.1; child_process, cross-platform) ----------
ipcMain.handle('exec:run', async (_e, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, { cwd: workspaceRoot, timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout).slice(0, 20000), stderr: String(stderr).slice(0, 20000) });
    });
  });
});

// ---------- IPC: LLM passthrough ----------
ipcMain.handle('llm:ping', async (_e, host) => {
  try {
    const r = await fetch(`${host || 'http://127.0.0.1:11434'}/api/tags`);
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

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
  try { await fs.unlink(path.join(chatsDir(), `${id}.json`)); } catch { /* no chat yet */ }
  return data;
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
  if (!p) return data;
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
  shell.showItemInFolder(targetPath || workspaceRoot);
  return true;
});

// Per-project chat history (survives folder moves; stored in userData)
ipcMain.handle('projects:get-chat', async (_e, id) => {
  try {
    const raw = await fs.readFile(path.join(chatsDir(), `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
});
ipcMain.handle('projects:save-chat', async (_e, id, msgs) => {
  await ensureStore();
  await fs.writeFile(path.join(chatsDir(), `${id}.json`), JSON.stringify((msgs || []).slice(-100), null, 2));
  return true;
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
  const r = await runBin('gh', ['repo', 'list', '--limit', String(limit || 50), '--json', 'nameWithOwner,url,isPrivate,updatedAt']);
  if (!r.ok) return { ok: false, error: r.error, repos: [] };
  try {
    return { ok: true, repos: JSON.parse(r.out) };
  } catch (err) {
    return { ok: false, error: String(err), repos: [] };
  }
});
ipcMain.handle('github:auth', async () => {
  const r = await runBin('gh', ['auth', 'status']);
  return { ok: r.ok, out: (r.out || r.error || '').slice(0, 1000) };
});
ipcMain.handle('projects:clone', async (_e, repoFullName, parentDir) => {
  const clean = String(repoFullName || '').trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(clean)) return { ok: false, error: 'Use OWNER/REPO format, e.g. LexSort-Inc/CodeIT' };
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
  const state = await loadToolState();
  if (scope && scope !== 'global') {
    state.projectOverrides[scope] = state.projectOverrides[scope] || {};
    state.projectOverrides[scope][toolId] = enabled;
  } else state.enabled[toolId] = enabled;
  await saveToolState(state);
  return { ok: true };
});
ipcMain.handle('tools:always-allow', async (_e, toolKey) => {
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
  const state = await loadToolState();
  const toolKey = `${serverId}.${toolName}`;
  const autoOk = entry.risk === 'read' || (approved === 'once') || state.alwaysAllow.includes(toolKey);
  if (!autoOk) {
    return { ok: false, needsApproval: true, serverId, toolName, toolArgs, risk: entry.risk };
  }
  const keys = await readKeys();
  try {
    const result = await mcp.callTool(entry, toolName, toolArgs, { projectDir: workspaceRoot, keys });
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

app.on('before-quit', () => mcp.stopAll());
