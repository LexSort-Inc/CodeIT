import { useState } from 'react';

export default function TerminalPane() {
  const [cmd, setCmd] = useState('ollama list');
  const [log, setLog] = useState(['CodeIT runner — approval: every command runs only when you press Run. cd = workspace root.']);
  const [busy, setBusy] = useState(false);

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
      <div style={{ flex: 1, overflowY: 'auto', background: '#000', color: '#0f0', fontFamily: 'ui-monospace,monospace', fontSize: 12, padding: 8, whiteSpace: 'pre-wrap' }}>
        {log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 6 }}>
        <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()}
          style={{ flex: 1 }} placeholder="npm test / ollama list / python3 script.py" />
        <button onClick={run} disabled={busy}>{busy ? '…' : 'Run'}</button>
      </div>
    </div>
  );
}
