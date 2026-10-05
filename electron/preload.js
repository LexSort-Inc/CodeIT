const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeit', {
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  getRoot: () => ipcRenderer.invoke('workspace:root'),
  fsList: () => ipcRenderer.invoke('fs:list'),
  fsRead: (p) => ipcRenderer.invoke('fs:read', p),
  fsWrite: (p, c) => ipcRenderer.invoke('fs:write', p, c),
  execRun: (cmd) => ipcRenderer.invoke('exec:run', cmd),
  llmPing: (host) => ipcRenderer.invoke('llm:ping', host),
  // projects — organized multi-project workflow (local folders + GitHub repos)
  projectsList: () => ipcRenderer.invoke('projects:list'),
  projectsAddLocal: () => ipcRenderer.invoke('projects:add-local'),
  projectsActivate: (id) => ipcRenderer.invoke('projects:activate', id),
  projectsRemove: (id) => ipcRenderer.invoke('projects:remove', id),
  projectsRename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
  projectsPin: (id, filePath) => ipcRenderer.invoke('projects:pin', id, filePath),
  projectsUnpin: (id, filePath) => ipcRenderer.invoke('projects:unpin', id, filePath),
  projectsReveal: (p) => ipcRenderer.invoke('projects:reveal', p),
  projectsGetChat: (id) => ipcRenderer.invoke('projects:get-chat', id),
  projectsSaveChat: (id, msgs) => ipcRenderer.invoke('projects:save-chat', id, msgs),
  projectsClone: (repo, parentDir) => ipcRenderer.invoke('projects:clone', repo, parentDir),
  gitInfo: () => ipcRenderer.invoke('git:info'),
  githubRepos: (limit) => ipcRenderer.invoke('github:repos', limit),
  githubAuth: () => ipcRenderer.invoke('github:auth')
});
