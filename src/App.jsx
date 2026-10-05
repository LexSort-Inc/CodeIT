import { useCallback, useEffect, useRef, useState } from 'react';
import ChatPane from './components/ChatPane.jsx';
import FileExplorer from './components/FileExplorer.jsx';
import TerminalPane from './components/TerminalPane.jsx';
import WebviewDock from './components/WebviewDock.jsx';
import Settings from './components/Settings.jsx';
import ProjectsPane from './components/ProjectsPane.jsx';
import ExtensionsPane from './components/ExtensionsPane.jsx';
import './styles.css';

export default function App() {
  const [provider, setProvider] = useState('ollama');
  const [model, setModel] = useState('qwen2.5-coder:7b');
  const [file, setFile] = useState(null);
  const [fileContext, setFileContext] = useState(null);
  const [root, setRoot] = useState('');
  const [rightTab, setRightTab] = useState('terminal'); // terminal | web | notes
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [git, setGit] = useState({ branch: '', dirty: 0, remote: '', isRepo: false });
  const [notes, setNotes] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [railTab, setRailTab] = useState('projects'); // projects | extensions
  const [filesOpen, setFilesOpen] = useState(false); // files+editor drawer, closed by default
  const [toolCount, setToolCount] = useState(0);
  const editorOpenRef = useRef(null);

  const active = projects.find((p) => p.id === activeId) || null;

  async function reloadProjects(selectId) {
    if (!window.codeit?.projectsList) return;
    const data = await window.codeit.projectsList();
    setProjects(data.projects);
    setActiveId(selectId ?? data.activeId);
  }
  useEffect(() => { reloadProjects(); }, []);

  async function selectProject(id) {
    if (!window.codeit?.projectsActivate) { setActiveId(id); return; }
    const r = await window.codeit.projectsActivate(id);
    if (r) {
      setProjects(r.data.projects);
      setActiveId(r.project.id);
      setRoot(r.root);
      setFile(null);
      setFileContext(null);
      setRefreshKey((k) => k + 1);
      const g = await window.codeit.gitInfo();
      setGit(g);
      loadNotes(r.project);
    }
  }

  const loadNotes = useCallback(async (project) => {
    if (!project || !window.codeit?.fsRead) { setNotes(''); return; }
    try {
      const sep = window.navigator?.platform?.includes('Win') ? '\\' : '/';
      const n = await window.codeit.fsRead(`${project.path}${sep}.codeit${sep}CONTEXT.md`);
      setNotes(n);
    } catch { setNotes(''); }
  }, []);

  useEffect(() => { if (active) { loadNotes(active); window.codeit?.gitInfo?.().then(setGit).catch(() => {}); } }, [activeId]); // eslint-disable-line

  async function saveNotes() {
    if (!active || !window.codeit?.fsWrite) return;
    const sep = window.navigator?.platform?.includes('Win') ? '\\' : '/';
    await window.codeit.fsWrite(`${active.path}${sep}.codeit${sep}CONTEXT.md`, notes);
  }

  async function removeProject() {
    if (!active || !confirm(`Remove "${active.name}" from CodeIT? (Files stay on disk.)`)) return;
    const data = await window.codeit.projectsRemove(active.id);
    setProjects(data.projects);
    setActiveId(data.activeId);
    setRefreshKey((k) => k + 1);
  }

  async function renameProject() {
    if (!active) return;
    const name = prompt('Rename project:', active.name);
    if (!name) return;
    const data = await window.codeit.projectsRename(active.id, name);
    setProjects(data.projects);
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>CodeIT</strong>
        <span className="muted">{active ? `${active.kind === 'github' ? '⬣' : '📁'} ${active.name}` : 'no project selected'}</span>
        {git.isRepo && <span className="muted">· {git.branch || 'detached'}{git.dirty ? ` · ●${git.dirty}` : ' · clean'}</span>}
        <span style={{ flex: 1 }} />
        {active && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setFilesOpen(!filesOpen)} title="Toggle files + editor drawer">{filesOpen ? 'Hide files' : 'Files'}</button>
            <button onClick={() => window.codeit?.projectsReveal(active.path)} title="Show in Finder/Explorer">Reveal</button>
            <button onClick={renameProject} title="Rename project">Rename</button>
            <button onClick={removeProject} title="Remove from list (keeps files)">✕</button>
          </span>
        )}
        <Settings provider={provider} setProvider={setProvider} model={model} setModel={setModel} toolCount={toolCount} />
      </header>
      <div className={`grid-projects${filesOpen ? '' : ' files-closed'}`}>
        <section className="pane rail">
          <div className="pane-title tabs">
            <button onClick={() => setRailTab('projects')} className={railTab === 'projects' ? 'active' : ''}>Projects ({projects.length})</button>
            <button onClick={() => setRailTab('extensions')} className={railTab === 'extensions' ? 'active' : ''}>Extensions</button>
          </div>
          <div className="pane-body">
            {railTab === 'projects'
              ? <ProjectsPane activeId={activeId} onSelect={selectProject} refreshKey={refreshKey} />
              : <ExtensionsPane project={active} />}
          </div>
        </section>
        <section className="pane">
          <div className="pane-title">Chat — multi-model {fileContext ? `· +${fileContext.path.split(/[\\/]/).pop()}` : ''}</div>
          <div className="pane-body"><ChatPane provider={provider} model={model} fileContext={fileContext} project={active} projectNotes={notes} onToolCount={setToolCount} /></div>
        </section>
        <section className="pane files-pane">
          <div className="pane-title">Files {root ? `· ${root}` : ''}</div>
          <div className="pane-body files">
            <FileExplorer root={root} setRoot={setRoot} onOpenFile={(f) => { setFile(f); editorOpenRef.current?.(f); }} refreshKey={refreshKey} activePath={active?.path} />
          </div>
          <div className="pane-title">Editor {active?.pinned?.length ? `· 📌${active.pinned.length}` : ''}</div>
          <div className="pane-body editor">
            <EditorPaneInner file={file} setFile={setFile} onAttach={setFileContext} openRef={editorOpenRef} project={active} onPinChanged={() => reloadProjects(activeId)} />
          </div>
        </section>
        <section className="pane">
          <div className="pane-title tabs">
            <button onClick={() => setRightTab('terminal')} className={rightTab === 'terminal' ? 'active' : ''}>Terminal</button>
            <button onClick={() => setRightTab('notes')} className={rightTab === 'notes' ? 'active' : ''}>Notes</button>
            <button onClick={() => setRightTab('web')} className={rightTab === 'web' ? 'active' : ''}>Web dock</button>
          </div>
          <div className="pane-body">
            {rightTab === 'terminal' ? <TerminalPane cwd={root} />
              : rightTab === 'notes' ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ padding: 6, borderBottom: '1px solid #30363d', fontSize: 12, opacity: 0.7 }}>
                    Project context — auto-attached to every chat in this project. Stored in <code>.codeit/CONTEXT.md</code> inside the project.
                  </div>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Stack, conventions, goals, gotchas… e.g. React 18, Ollama default, run npm test before commit"
                    spellCheck={false} style={{ flex: 1, background: '#0d1117', color: '#e6edf3', border: 0, padding: 10, fontSize: 13, resize: 'none' }} />
                  <div style={{ padding: 6, borderTop: '1px solid #30363d' }}><button onClick={saveNotes} disabled={!active}>Save notes</button></div>
                </div>
              ) : <WebviewDock />}
          </div>
        </section>
      </div>
    </div>
  );
}

// Editor with pin-to-project support
function EditorPaneInner(props) {
  return <EditorPaneWithRef {...props} />;
}
function EditorPaneWithRef({ openRef, project, onPinChanged, ...rest }) {
  const [file, setFile] = [rest.file, rest.setFile];
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    openRef.current = async (f) => {
      setFile(f);
      if (window.codeit) { try { setContent(await window.codeit.fsRead(f.path)); } catch { setContent(''); } }
    };
  }, []);
  const isPinned = project?.pinned?.includes(file?.path);
  async function save() {
    if (!file || !window.codeit) return;
    await window.codeit.fsWrite(file.path, content);
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    setTimeout(() => setStatus(''), 2000);
  }
  async function togglePin() {
    if (!project || !file) return;
    if (isPinned) await window.codeit.projectsUnpin(project.id, file.path);
    else await window.codeit.projectsPin(project.id, file.path);
    onPinChanged?.();
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid #30363d', alignItems: 'center' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{file ? file.path : 'No file — pick one from explorer'}</span>
        <span style={{ flex: 1 }} />
        {file && <button onClick={() => rest.onAttach({ path: file.path, content })}>+File to chat</button>}
        {file && project && <button onClick={togglePin} title="Pin: always include in project context">{isPinned ? 'Unpin' : 'Pin'}</button>}
        {file && <button onClick={save}>Save</button>}
        {status && <span style={{ fontSize: 12, color: '#3fb950' }}>{status}</span>}
      </div>
      {project?.pinned?.length > 0 && (
        <div style={{ padding: '4px 8px', borderBottom: '1px solid #30363d', fontSize: 11, opacity: 0.8 }}>
          📌 {project.pinned.map((p) => p.split(/[\\/]/).pop()).join(', ')}
        </div>
      )}
      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="// open a file to edit"
        spellCheck={false} style={{ flex: 1, background: '#0d1117', color: '#e6edf3', border: 0, padding: 10, fontFamily: 'ui-monospace,monospace', fontSize: 13, resize: 'none' }} />
    </div>
  );
}
