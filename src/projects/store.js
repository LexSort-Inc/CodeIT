// Renderer-side project helpers. In Electron, main process is source of truth
// (userData/projects.json). In browser preview, fall back to localStorage.
const LS_KEY = 'codeit.projects.fallback';

export async function listProjects() {
  if (window.codeit?.projectsList) return window.codeit.projectsList();
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{"activeId":null,"projects":[]}');
  } catch {
    return { activeId: null, projects: [] };
  }
}

export function kindIcon(kind) {
  return kind === 'github' ? '⬣' : '📁';
}
