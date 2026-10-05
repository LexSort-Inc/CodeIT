import { useEffect, useState } from 'react';

// Extensions store: curated catalog, per-project toggles, compatibility badges.
// Scope rule: toggles apply to the active project; "global" link sets the default for new projects.
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

  function badge(c) {
    const b = [];
    if (c.localReady) b.push(['Local-ready', '#3fb950']);
    if (c.cloudPreferred) b.push(['Cloud-preferred', '#d29922']);
    if (c.needsKey) b.push([`Needs key: ${c.needsKey}`, '#888']);
    if (c.risk === 'write') b.push(['Writes guarded', '#f85149']);
    return b;
  }

  const skillBodies = Object.fromEntries(skills.map((s) => [s.id, s]));
  const q = filter.trim().toLowerCase();
  const items = catalog.filter((c) => !q || `${c.name} ${c.blurb}`.toLowerCase().includes(q));
  const mcp = items.filter((c) => c.kind === 'mcp');
  const sk = items.filter((c) => c.kind === 'skill');

  if (!window.codeit) return <div style={{ padding: 12, fontSize: 13 }}>Extensions need Electron (`npm run dev`).</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #30363d', display: 'flex', gap: 6 }}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search extensions…" style={{ flex: 1 }} />
        <button onClick={refresh} title="Rescan">↻</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, opacity: 0.6 }}>Toggles apply to project: <strong>{project ? project.name : '(global default)'}</strong>. Curated catalog only — custom installs live behind Advanced in v0.3.</div>
        <Section title={`Tools — MCP servers (${mcp.length})`}>
          {mcp.map((c) => (
            <Card key={c.id} item={c} badges={badge(c)} busy={busy === c.id}
              onToggle={(v) => toggle(c.id, v)}
              extra={c.needsKey ? <span style={{ fontSize: 11, opacity: 0.7 }}>Add the {c.needsKey} key in top-bar Keys.</span> : null} />
          ))}
        </Section>
        <Section title={`Skills — markdown + scripts (${sk.length})`}>
          {sk.map((c) => {
            const loaded = skillBodies[c.id];
            return (
              <Card key={c.id} item={c} badges={[...badge(c), ...(loaded ? [['Loaded ✓', '#58a6ff']] : [['Not found on disk', '#888']])]} busy={busy === c.id}
                onToggle={(v) => toggle(c.id, v)}
                extra={loaded ? <span style={{ fontSize: 11, opacity: 0.7 }}>{loaded.description}</span> : <span style={{ fontSize: 11, opacity: 0.7 }}>Bundled with CodeIT repo.</span>} />
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
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.7, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Card({ item, badges, busy, onToggle, extra }) {
  return (
    <div style={{ border: '1px solid #30363d', borderRadius: 8, padding: '8px 10px', background: item.enabled ? '#161b22' : '#0d1117', opacity: item.enabled ? 1 : 0.75 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{item.kind === 'mcp' ? '🧰' : '📜'} {item.name}</span>
        <button onClick={() => onToggle(!item.enabled)} disabled={busy} style={{ fontSize: 12 }}>
          {busy ? '…' : item.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      <div style={{ fontSize: 12, opacity: 0.8, margin: '4px 0' }}>{item.blurb}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {badges.map(([label, color]) => (
          <span key={label} style={{ fontSize: 10, border: `1px solid ${color}`, color, borderRadius: 10, padding: '1px 7px' }}>{label}</span>
        ))}
      </div>
      {extra && <div style={{ marginTop: 4 }}>{extra}</div>}
    </div>
  );
}
