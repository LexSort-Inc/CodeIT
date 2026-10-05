const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { exec } = require('child_process');

const isDev = !app.isPackaged;
let mainWindow;
let workspaceRoot = require('os').homedir();

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
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
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- IPC: workspace fs ----------
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
  await fs.writeFile(filePath, content, 'utf8');
  return true;
});

// ---------- IPC: command runner (no native node-pty in v0.1; child_process, cross-platform) ----------
// v0.2 upgrade path: node-pty + xterm.js for full interactive PTY (needed for ThinkCenter parity test).
ipcMain.handle('exec:run', async (_e, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, { cwd: workspaceRoot, timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout).slice(0, 20000), stderr: String(stderr).slice(0, 20000) });
    });
  });
});

// ---------- IPC: LLM passthrough (keeps renderer free of CORS/keychain issues) ----------
// Simple non-streaming relay. Streaming happens renderer-side for Ollama browser fetch;
// main-process relay used when keys must stay out of renderer or for Windows parity.
ipcMain.handle('llm:ping', async (_e, host) => {
  try {
    const r = await fetch(`${host || 'http://127.0.0.1:11434'}/api/tags`);
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
