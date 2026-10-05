import { useEffect, useState } from 'react';
import { Empty } from './ui.jsx';
import { fmtMs } from '../llm/pricing.js';

// Background tasks: long commands keep running; tail live output; kill when done.
// Backed by tasks:* IPC (spawn-based, survives chat navigation).
export default function TasksPane() {
  const [tasks, setTasks] = useState([]);
  const [tails, setTails] = useState({});
  async function refresh() {
    if (!window.codeit?.tasksList) return;
    setTasks(await window.codeit.tasksList());
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, []);
  async function toggleTail(id) {
    if (tails[id]) { setTails((s) => { const c = { ...s }; delete c[id]; return c; }); return; }
    const r = await window.codeit.tasksTail(id);
    setTails((s) => ({ ...s, [id]: r.out || '(no output yet)' }));
  }
  async function kill(id) {
    await window.codeit.tasksKill(id);
    refresh();
  }
  if (!window.codeit?.tasksList) return <Empty>Background tasks need Electron (`npm run dev`).</Empty>;
  return (
    <div className="pane-body scroll pad stack">
      {tasks.length === 0 && <Empty>No background tasks. Run a long command from Terminal with “Run in background”.</Empty>}
      {tasks.map((t) => (
        <div key={t.id} className="card">
          <div className="row">
            <span className={t.running ? 'dot-live' : t.code === 0 ? 'dot-done' : 'dot-fail'}>●</span>
            <span className="title" style={{ flex: 1 }}>$ {t.cmd}</span>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>{fmtMs(t.ms)}</span>
          </div>
          <div className="sub">{t.running ? 'running…' : `exit ${t.code}`} · started {new Date(t.startedAt).toLocaleTimeString()}</div>
          <div className="row" style={{ marginTop: 4 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => toggleTail(t.id)}>{tails[t.id] ? 'Hide output' : 'Output'}</button>
            {t.running && <button className="btn btn-sm btn-danger" onClick={() => kill(t.id)}>Kill</button>}
          </div>
          {tails[t.id] && <pre style={{ marginTop: 4 }}>{tails[t.id].slice(-6000)}</pre>}
        </div>
      ))}
    </div>
  );
}
