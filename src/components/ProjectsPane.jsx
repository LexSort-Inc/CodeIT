import { useEffect, useState } from 'react';
import { kindIcon } from '../projects/store.js';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={addLocal} title="Add a local folder as a project" style={{ flex: 1 }}>+ Folder</button>
          <button onClick={openCloner} title="Clone a GitHub repo as a project" style={{ flex: 1 }}>+ GitHub</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {!window.codeit && <div style={{ fontSize: 12, opacity: 0.7 }}>Projects need Electron (`npm run dev`).</div>}
        {filtered.map((p) => (
          <div key={p.id} onClick={() => onSelect(p.id)}
            style={{ cursor: 'pointer', border: '1px solid #30363d', borderRadius: 8, padding: '7px 8px', background: p.id === activeId ? '#1f6feb33' : '#161b22' }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {kindIcon(p.kind)} {p.name}
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.repo || p.path}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>No projects yet — add a folder or clone a repo.</div>}
      </div>
      {showClone && (
        <div style={{ borderTop: '1px solid #30363d', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50%', overflowY: 'auto' }}>
          <strong style={{ fontSize: 13 }}>Clone from GitHub</strong>
          {reposErr && <div style={{ fontSize: 11, color: '#f0883e' }}>{reposErr}</div>}
          {repos.map((r) => (
            <div key={r.nameWithOwner} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.nameWithOwner}{r.isPrivate ? ' 🔒' : ''}</span>
              <button onClick={() => setRepoInput(r.nameWithOwner)}>Use</button>
            </div>
          ))}
          <input value={repoInput} onChange={(e) => setRepoInput(e.target.value)} placeholder="OWNER/REPO e.g. owner/repo" />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={clone} disabled={busy} style={{ flex: 1 }}>{busy ? 'Cloning…' : 'Clone & open'}</button>
            <button onClick={() => setShowClone(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
