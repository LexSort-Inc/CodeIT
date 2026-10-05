import { useEffect, useState } from 'react';
import { kindIcon } from '../projects/store.js';
import { Empty } from './ui.jsx';

// Left rail: organized projects — local folders + GitHub clones.
// Each project keeps its own path, chat history, pinned files.
export default function ProjectsPane({ activeId, onSelect, refreshKey }) {
  const [data, setData] = useState({ activeId: null, projects: [] });
  const [q, setQ] = useState('');
  const [showClone, setShowClone] = useState(false);
  const [repos, setRepos] = useState([]);
  const [reposErr, setReposErr] = useState('');
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!window.codeit) return;
    setData(await window.codeit.projectsList());
  }
  useEffect(() => { refresh(); }, [refreshKey, activeId]);

  async function addLocal() {
    const r = await window.codeit.projectsAddLocal();
    if (r) onSelect(r.project.id);
  }
  async function clone() {
    if (!repoInput.trim() || busy) return;
    setBusy(true);
    const r = await window.codeit.projectsClone(repoInput.trim());
    setBusy(false);
    if (r.ok) { setShowClone(false); setRepoInput(''); onSelect(r.project.id); }
    else alert(`Clone failed: ${r.error}`);
  }
  async function openCloner() {
    setShowClone(true);
    setReposErr('');
    const r = await window.codeit.githubRepos(50);
    if (r.ok) setRepos(r.repos);
    else setReposErr(r.error || 'gh not authed — you can still paste OWNER/REPO below.');
  }

  const filtered = data.projects.filter((p) =>
    !q.trim() || p.name.toLowerCase().includes(q.toLowerCase()) || (p.repo || '').toLowerCase().includes(q.toLowerCase()));

  function onCardKey(e, id) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pad stack">
        <label className="sr-only" htmlFor="codeit-project-search">Search projects</label>
        <input id="codeit-project-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" />
        <div className="row">
          <button className="btn btn-sm" onClick={addLocal} title="Add a local folder as a project" style={{ flex: 1 }}>+ Folder</button>
          <button className="btn btn-sm" onClick={openCloner} title="Clone a GitHub repo as a project" style={{ flex: 1 }}>+ GitHub</button>
        </div>
      </div>
      <div className="pane-body scroll pad" style={{ gap: 4 }} role="listbox" aria-label="Projects">
        {!window.codeit && <Empty>Projects need Electron (`npm run dev`).</Empty>}
        {filtered.map((p) => (
          <div key={p.id} role="option" aria-selected={p.id === activeId} tabIndex={0}
            onClick={() => onSelect(p.id)} onKeyDown={(e) => onCardKey(e, p.id)}
            className={`card selectable${p.id === activeId ? ' selected' : ''}`}>
            <div className="title">{kindIcon(p.kind)} {p.name}</div>
            <div className="sub">{p.repo || p.path}</div>
          </div>
        ))}
        {filtered.length === 0 && <Empty>No projects yet — add a folder or clone a repo.</Empty>}
      </div>
      {showClone && (
        <div className="toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', maxHeight: '50%', overflowY: 'auto' }}>
          <strong style={{ fontSize: 13 }}>Clone from GitHub</strong>
          {reposErr && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{reposErr}</div>}
          {repos.map((r) => (
            <div key={r.nameWithOwner} className="row" style={{ fontSize: 12 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.nameWithOwner}{r.isPrivate ? ' 🔒' : ''}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setRepoInput(r.nameWithOwner)}>Use</button>
            </div>
          ))}
          <label className="sr-only" htmlFor="codeit-clone-input">Repository OWNER/REPO</label>
          <input id="codeit-clone-input" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} placeholder="OWNER/REPO e.g. owner/repo" />
          <div className="row">
            <button className="btn btn-sm btn-primary" onClick={clone} disabled={busy} style={{ flex: 1 }}>{busy ? 'Cloning…' : 'Clone & open'}</button>
            <button className="btn btn-sm" onClick={() => setShowClone(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
