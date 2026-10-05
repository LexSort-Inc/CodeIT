import { useEffect, useState } from 'react';
import { Badge, Empty } from './ui.jsx';

// Extensions store: curated catalog, per-project toggles, compatibility badges.
// Scope rule: toggles apply to the active project; "global" sets the default for new projects.
export default function ExtensionsPane({ project }) {
  const [catalog, setCatalog] = useState([]);
  const [skills, setSkills] = useState([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');

  async function refresh() {
    if (!window.codeit) return;
    setCatalog(await window.codeit.toolsCatalog());
    setSkills(await window.codeit.skillsList());
  }
  useEffect(() => { refresh(); }, [project?.id]);

  async function toggle(id, enabled) {
    setBusy(id);
    await window.codeit.toolsSetEnabled(id, enabled, project?.id || 'global');
    await refresh();
    setBusy('');
  }

  function badges(c) {
    const b = [];
    if (c.localReady) b.push(['Local-ready', 'green']);
    if (c.cloudPreferred) b.push(['Cloud-preferred', 'amber']);
    if (c.needsKey) b.push([`Needs key: ${c.needsKey}`, '']);
    if (c.risk === 'write') b.push(['Writes guarded', 'red']);
    return b;
  }

  const skillBodies = Object.fromEntries(skills.map((s) => [s.id, s]));
  const q = filter.trim().toLowerCase();
  const items = catalog.filter((c) => !q || `${c.name} ${c.blurb}`.toLowerCase().includes(q));
  const mcp = items.filter((c) => c.kind === 'mcp');
  const sk = items.filter((c) => c.kind === 'skill');

  if (!window.codeit) return <Empty>Extensions need Electron (`npm run dev`).</Empty>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="toolbar">
        <label className="sr-only" htmlFor="codeit-ext-search">Search extensions</label>
        <input id="codeit-ext-search" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search extensions…" style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={refresh} title="Rescan">↻</button>
      </div>
      <div className="pane-body scroll pad stack" style={{ gap: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--dim)' }}>Toggles apply to project: <strong>{project ? project.name : '(global default)'}</strong>.</div>
        <Section title={`Tools — MCP servers (${mcp.length})`}>
          {mcp.map((c) => (
            <Card key={c.id} item={c} badges={badges(c)} busy={busy === c.id}
              onToggle={(v) => toggle(c.id, v)}
              extra={c.needsKey ? <span style={{ fontSize: 11, color: 'var(--dim)' }}>Add the {c.needsKey} key in top-bar Keys.</span> : null} />
          ))}
        </Section>
        <Section title={`Skills — markdown + scripts (${sk.length})`}>
          {sk.map((c) => {
            const loaded = skillBodies[c.id];
            return (
              <Card key={c.id} item={c}
                badges={[...badges(c), ...(loaded ? [['Loaded ✓', 'blue']] : [['Not found on disk', '']])]}
                busy={busy === c.id} onToggle={(v) => toggle(c.id, v)}
                extra={<span style={{ fontSize: 11, color: 'var(--dim)' }}>{loaded ? loaded.description : 'Bundled with CodeIT repo.'}</span>} />
            );
          })}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="pane-title" style={{ border: 0, paddingLeft: 0 }}>{title}</div>
      <div className="stack">{children}</div>
    </div>
  );
}

function Card({ item, badges, busy, onToggle, extra }) {
  return (
    <div className={`card${item.enabled ? '' : ' off'}`}>
      <div className="row">
        <span className="title" style={{ flex: 1 }}>{item.kind === 'mcp' ? '🧰' : '📜'} {item.name}</span>
        <button className="btn btn-sm" onClick={() => onToggle(!item.enabled)} disabled={busy} aria-pressed={item.enabled}>
          {busy ? '…' : item.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--dim)', margin: '4px 0' }}>{item.blurb}</div>
      <div className="badges">
        {badges.map(([label, color]) => <Badge key={label} color={color}>{label}</Badge>)}
      </div>
      {extra && <div style={{ marginTop: 4 }}>{extra}</div>}
    </div>
  );
}
