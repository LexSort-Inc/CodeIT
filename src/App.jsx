import { useCallback, useEffect, useRef, useState } from 'react';
import ChatPane from './components/ChatPane.jsx';
import FileExplorer from './components/FileExplorer.jsx';
import TerminalPane from './components/TerminalPane.jsx';
import WebviewDock from './components/WebviewDock.jsx';
import Settings from './components/Settings.jsx';
import ProjectsPane from './components/ProjectsPane.jsx';
import ExtensionsPane from './components/ExtensionsPane.jsx';
import UsagePane from './components/UsagePane.jsx';
import EditorPaneInner from './components/EditorPaneInner.jsx';
import TasksPane from './components/TasksPane.jsx';
import StatusBar from './components/StatusBar.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { Tabs, Menu } from './components/ui.jsx';
import './styles.css';

export default function App() {
  const [provider, setProvider] = useState('ollama');
  const [model, setModel] = useState('qwen2.5-coder:7b');
  const [file, setFile] = useState(null);
  const [fileContext, setFileContext] = useState(null);
  const [root, setRoot] = useState('');
  const [rightTab, setRightTab] = useState('terminal'); // terminal | tasks | notes | web
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [git, setGit] = useState({ branch: '', dirty: 0, remote: '', isRepo: false });
  const [notes, setNotes] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [railTab, setRailTab] = useState('projects'); // projects | extensions | usage
  const [filesOpen, setFilesOpen] = useState(false); // files+editor drawer, closed by default
  const [toolCount, setToolCount] = useState(0);
  const [zen, setZen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [usageTick, setUsageTick] = useState(0);
  const editorOpenRef = useRef(null);
  const threadEditorRef = useRef(null); // ChatPane registers: record opened file on active thread

  function openFile(f) {
    setFile(f);
    editorOpenRef.current?.(f);
    threadEditorRef.current?.(f.path);
  }

  // switching threads restores that thread's file in the editor
  function onThreadSwitch({ editorPath }) {
    if (!editorPath || editorPath === file?.path) return;
    if (!window.codeit) return;
    window.codeit.fsRead(editorPath).then(() => {
      const f = { path: editorPath, name: editorPath.split(/[\\/]/).pop(), type: 'file' };
      setFile(f);
      editorOpenRef.current?.(f);
    }).catch(() => {});
  }

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
    if (!active || !window.codeit?.projectsRemove) return;
    if (!confirm(`Remove "${active.name}" from CodeIT? (Files stay on disk.)`)) return;
    const data = await window.codeit.projectsRemove(active.id);
    setProjects(data.projects);
    setActiveId(data.activeId);
    setRefreshKey((k) => k + 1);
  }

  async function renameProject() {
    if (!active || !window.codeit?.projectsRename) return;
    const name = prompt('Rename project:', active.name);
    if (!name) return;
    const data = await window.codeit.projectsRename(active.id, name);
    setProjects(data.projects);
  }

  // global shortcuts: Cmd/Ctrl+K palette, Cmd/Ctrl+K Z zen handled in palette
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app${zen ? ' zen' : ''}`}>
      <header className="topbar">
        <strong className="brand">CodeIT</strong>
        <span className="muted">{active ? `${active.kind === 'github' ? '⬣' : '📁'} ${active.name}` : 'no project selected'}</span>
        {git.isRepo && <span className="muted">· {git.branch || 'detached'}{git.dirty ? ` · ●${git.dirty}` : ' · clean'}</span>}
        <span className="spacer" />
        {active && (
          <span className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => setFilesOpen(!filesOpen)} title="Toggle files + editor drawer">{filesOpen ? 'Hide files' : 'Files'}</button>
            <Menu label="…">
              <button onClick={() => window.codeit?.projectsReveal(active.path)}>Reveal in Finder/Explorer</button>
              <button onClick={renameProject}>Rename project</button>
              <button className="danger" onClick={removeProject}>Remove (keeps files)</button>
            </Menu>
          </span>
        )}
        <Settings provider={provider} setProvider={setProvider} model={model} setModel={setModel} toolCount={toolCount} />
      </header>
      <div className={`grid-projects${filesOpen ? '' : ' files-closed'}`}>
        <section className="pane rail" aria-label="Projects and extensions">
          <div className="pane-title tabs">
            <Tabs tabs={['projects', 'extensions', 'usage']} active={railTab} onChange={setRailTab}
              labels={{ projects: `Projects (${projects.length})`, extensions: 'Extensions', usage: 'Usage' }} />
          </div>
          <div className="pane-body">
            {railTab === 'projects'
              ? <ProjectsPane activeId={activeId} onSelect={selectProject} refreshKey={refreshKey} />
              : railTab === 'extensions'
                ? <ExtensionsPane project={active} />
                : <UsagePane refreshKey={refreshKey} />}
          </div>
        </section>
        <section className="pane" aria-label="Chat">
          <div className="pane-title">Chat — multi-model {fileContext ? `· +${fileContext.path.split(/[\\/]/).pop()}` : ''}</div>
          <div className="pane-body">
            <ChatPane provider={provider} model={model} fileContext={fileContext} setFileContext={setFileContext}
              project={active} projectNotes={notes} onToolCount={setToolCount} planMode={planMode} setPlanMode={setPlanMode}
              onUsageTick={() => setUsageTick((t) => t + 1)} onThreadSwitch={onThreadSwitch}
              registerThreadEditor={(fn) => { threadEditorRef.current = fn; }} />
          </div>
        </section>
        <section className="pane files-pane" aria-label="Files and editor">
          <div className="pane-title">Files {root ? `· ${root}` : ''}</div>
          <div className="pane-body files">
            <FileExplorer root={root} setRoot={setRoot} onOpenFile={openFile} refreshKey={refreshKey} activePath={active?.path} />
          </div>
          <div className="pane-title">Editor {active?.pinned?.length ? `· 📌${active.pinned.length}` : ''}</div>
          <div className="pane-body editor">
            <EditorPaneInner file={file} setFile={setFile} onAttach={setFileContext} openRef={editorOpenRef} project={active} onPinChanged={() => reloadProjects(activeId)} />
          </div>
        </section>
        <section className="pane side" aria-label="Terminal, notes, web">
          <div className="pane-title tabs">
            <Tabs tabs={['terminal', 'tasks', 'notes', 'web']} active={rightTab} onChange={setRightTab}
              labels={{ terminal: 'Terminal', tasks: 'Tasks', notes: 'Notes', web: 'Web dock' }} />
          </div>
          <div className="pane-body">
            {rightTab === 'terminal' ? <TerminalPane cwd={root} />
              : rightTab === 'tasks' ? <TasksPane />
              : rightTab === 'notes' ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div className="pad" style={{ borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--dim)' }}>
                    Project context — auto-attached to every chat in this project. Stored in <code>.codeit/CONTEXT.md</code> inside the project.
                  </div>
                  <label className="sr-only" htmlFor="codeit-notes">Project notes</label>
                  <textarea id="codeit-notes" className="code-area" value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="Stack, conventions, goals, gotchas…" spellCheck={false} />
                  <div className="toolbar"><span className="spacer" /><button className="btn btn-sm btn-primary" onClick={saveNotes} disabled={!active}>Save notes</button></div>
                </div>
              ) : <WebviewDock />}
          </div>
        </section>
      </div>
      <StatusBar project={active} git={git} toolCount={toolCount} usageTick={usageTick} zen={zen} setZen={setZen} onPalette={() => setPaletteOpen(true)} />
      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)}
          actions={[
            { id: 'zen', label: `${zen ? 'Exit' : 'Enter'} zen mode`, hint: '⌘K Z', run: () => setZen(!zen) },
            { id: 'files', label: `${filesOpen ? 'Hide' : 'Show'} files + editor`, run: () => setFilesOpen(!filesOpen) },
            { id: 'plan', label: `${planMode ? 'Exit' : 'Enter'} plan mode`, run: () => setPlanMode(!planMode) },
            { id: 'terminal', label: 'Open terminal tab', run: () => setRightTab('terminal') },
            { id: 'tasks', label: 'Open background tasks', run: () => setRightTab('tasks') },
            { id: 'notes', label: 'Open project notes', run: () => setRightTab('notes') },
            { id: 'web', label: 'Open web dock', run: () => setRightTab('web') },
            { id: 'ext', label: 'Open Extensions', run: () => setRailTab('extensions') },
            { id: 'usage', label: 'Open Usage', run: () => setRailTab('usage') },
            ...(active ? [{ id: 'reveal', label: 'Reveal project in Finder/Explorer', run: () => window.codeit?.projectsReveal(active.path) }] : []),
          ]} />
      )}
    </div>
  );
}
