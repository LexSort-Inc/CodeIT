import { useEffect, useState } from 'react';
import { Empty } from './ui.jsx';

// System tab: memory overview, CodeIT backends, and top RAM processes
// with guarded quit. Auto-refreshes while visible.
function fmtGB(b) {
  if (b == null) return '—';
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const DOT = { green: '#3fb950', yellow: '#d29922', red: '#f85149', unknown: '#6e7681' };

export default function SystemPane() {
  const [mem, setMem] = useState(null);
  const [procs, setProcs] = useState([]);
  const [procsErr, setProcsErr] = useState('');
  const [backends, setBackends] = useState({ sdxl: {}, video: {}, ollamaModels: [] });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');

  async function refresh() {
    if (!window.codeit) return;
    try {
      const [m, p, b] = await Promise.all([
        window.codeit.sysMem(), window.codeit.sysProcs(), window.codeit.backendsStatus(),
      ]);
      setMem(m);
      if (p.ok) { setProcs(p.procs); setProcsErr(''); } else setProcsErr(p.error || '');
      setBackends(b);
    } catch (e) {
      setMsg(String(e.message || e).slice(0, 200));
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(label, fn) {
    setBusy(label);
    setMsg('');
    try {
      const r = await fn();
      if (r && r.ok === false && r.error) setMsg(r.error);
      else if (r && r.unloaded) setMsg(`Unloaded: ${r.unloaded.join(', ') || 'nothing resident'}`);
      else if (label.startsWith('Quit')) setMsg('');
    } catch (e) {
      setMsg(String(e.message || e).slice(0, 200));
    }
    setBusy('');
    refresh();
  }

  async function quitProc(p) {
    if (!confirm(`Quit ${p.name} (pid ${p.pid}, ~${Math.round(p.rssMB)} MB)?\n\nUnsaved work in that app will be lost.`)) return;
    act(`Quit ${p.pid}`, () => window.codeit.sysKill(p.pid));
  }

  if (!window.codeit?.sysMem) return <Empty>System monitor needs Electron (`npm run dev`).</Empty>;
  const pct = mem ? Math.round((1 - mem.free / mem.total) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="pane-body scroll pad stack" style={{ gap: 10 }}>
        <section>
          <div className="pane-title" style={{ border: 0, paddingLeft: 0 }}>Memory</div>
          {mem ? (
            <div className="card">
              <div className="row">
                <span style={{ color: DOT[mem.pressure] || DOT.unknown, fontSize: 16 }}>●</span>
                <strong>{pct}% used</strong>
                <span className="sub">{fmtGB(mem.used)} of {fmtGB(mem.total)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg1)', marginTop: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: DOT[mem.pressure] || DOT.unknown }} />
              </div>
              <div className="sub" style={{ whiteSpace: 'normal', marginTop: 4 }}>
                Green = comfortable · yellow = compressing · red = swapping — unload something below.
              </div>
            </div>
          ) : <Empty>Reading memory…</Empty>}
        </section>
        <section>
          <div className="pane-title" style={{ border: 0, paddingLeft: 0 }}>CodeIT backends</div>
          <div className="stack">
            <BackendRow label="Ollama models" detail={(backends.ollamaModels || []).join(', ') || 'none resident'}
              action={backends.ollamaModels?.length ? { label: 'Unload all', fn: () => window.codeit.ollamaUnload('all') } : null}
              busy={busy} act={act} />
            <BackendRow label="Image server (:8002)" detail={backends.sdxl?.portUp ? 'running' : 'stopped'}
              action={backends.sdxl?.running ? { label: 'Stop', fn: () => window.codeit.backendsStopGiant('sdxl') } : null}
              busy={busy} act={act} />
            <BackendRow label="Video server (:8003)" detail={backends.video?.portUp ? 'running' : 'stopped'}
              action={backends.video?.running ? { label: 'Stop', fn: () => window.codeit.backendsStopGiant('video') } : null}
              busy={busy} act={act} />
          </div>
        </section>
        <section>
          <div className="pane-title" style={{ border: 0, paddingLeft: 0 }}>Top RAM usage</div>
          {procsErr && <Empty>{procsErr}</Empty>}
          <div className="stack">
            {procs.map((p) => (
              <div key={p.pid} className="card row">
                <span className="title" style={{ flex: 1 }} title={p.full || p.name}>{p.name}</span>
                <span className="sub">{Math.round(p.rssMB)} MB</span>
                <button className="btn btn-sm btn-ghost" disabled={!!busy} title={`Quit ${p.name} to free ~${Math.round(p.rssMB)} MB`}
                  onClick={() => quitProc(p)}>Quit</button>
              </div>
            ))}
            {!procs.length && !procsErr && <Empty>Reading processes…</Empty>}
          </div>
        </section>
        {msg && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{msg}</div>}
      </div>
    </div>
  );
}

function BackendRow({ label, detail, action, busy, act }) {
  return (
    <div className="card row">
      <span className="title" style={{ flex: 1 }}>{label}</span>
      <span className="sub">{detail}</span>
      {action && (
        <button className="btn btn-sm" disabled={!!busy} onClick={() => act(action.label, action.fn)}>
          {busy === action.label ? '…' : action.label}
        </button>
      )}
    </div>
  );
}
