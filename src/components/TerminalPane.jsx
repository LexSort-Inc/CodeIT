import { useState } from 'react';
import { Empty } from './ui.jsx';

export default function TerminalPane({ cwd }) {
  const [cmd, setCmd] = useState('ollama list');
  const [log, setLog] = useState(['CodeIT runner — approval: every command runs only when you press Run. cwd = active project. For long jobs use “Run in bg” + Tasks tab.']);
  const [busy, setBusy] = useState(false);

  async function runBg() {
    if (!window.codeit?.tasksStart || busy || !cmd.trim()) return;
    const r = await window.codeit.tasksStart(cmd);
    setLog((l) => [...l, `$ ${cmd}`, `→ background task ${r.id} — watch it in the Tasks tab.`]);
  }
  async function run() {
    if (!window.codeit || busy || !cmd.trim()) return;
    setBusy(true);
    setLog((l) => [...l, `$ ${cmd}`]);
    const r = await window.codeit.execRun(cmd);
    setLog((l) => [...l, r.stdout || '(no stdout)', r.stderr ? `STDERR: ${r.stderr}` : `— exit ${r.code}`].filter(Boolean));
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="term" role="log" aria-live="polite" aria-label="Terminal output">
        {cwd ? <div className="dim">cwd: {cwd}</div> : <Empty>Terminal needs Electron (`npm run dev`).</Empty>}
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      <div className="composer">
        <label className="sr-only" htmlFor="codeit-cmd">Command to run in project dir</label>
        <textarea id="codeit-cmd" rows={1} value={cmd} onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } }}
          placeholder="npm test / ollama list / python3 script.py" />
        <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? '…' : 'Run'}</button>
        <button className="btn btn-sm" onClick={runBg} disabled={busy} title="Run in background — watch in Tasks tab">Run in bg</button>
      </div>
    </div>
  );
}
