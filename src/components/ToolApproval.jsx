import { useState } from 'react';

// Approval gate: read tools auto-run; write/exec tools always land here.
// Allow once -> single call. Always allow -> persisted in keychain-side store.
export default function ToolApproval({ pending, onResolve }) {
  const [busy, setBusy] = useState(false);
  if (!pending) return null;
  const { serverId, name, args, risk } = pending;
  async function decide(choice) {
    setBusy(true);
    try {
      if (choice === 'always' && window.codeit?.toolsAlwaysAllow) {
        await window.codeit.toolsAlwaysAllow(`${serverId}.${name}`);
      }
      onResolve(choice === 'deny' ? { denied: true } : { approved: choice });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000a', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#161b22', border: '1px solid #f85149', borderRadius: 10, padding: 16, maxWidth: 460, width: '90%' }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠️ Tool approval {risk === 'write' ? '(write)' : ''}</div>
        <div style={{ fontSize: 13, marginBottom: 6 }}><code>{serverId}.{name}</code></div>
        <pre style={{ fontSize: 11, background: '#0d1117', padding: 8, borderRadius: 6, maxHeight: 160, overflow: 'auto' }}>
          {JSON.stringify(args || {}, null, 2).slice(0, 2000)}
        </pre>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={() => decide('once')} disabled={busy} style={{ flex: 1 }}>Allow once</button>
          <button onClick={() => decide('always')} disabled={busy} style={{ flex: 1 }}>Always allow</button>
          <button onClick={() => decide('deny')} disabled={busy}>Deny</button>
        </div>
      </div>
    </div>
  );
}
