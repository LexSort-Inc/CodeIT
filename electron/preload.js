const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeit', {
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  getRoot: () => ipcRenderer.invoke('workspace:root'),
  fsList: () => ipcRenderer.invoke('fs:list'),
  fsRead: (p) => ipcRenderer.invoke('fs:read', p),
  fsWrite: (p, c) => ipcRenderer.invoke('fs:write', p, c),
  execRun: (cmd) => ipcRenderer.invoke('exec:run', cmd),
  llmPing: (host) => ipcRenderer.invoke('llm:ping', host)
});
