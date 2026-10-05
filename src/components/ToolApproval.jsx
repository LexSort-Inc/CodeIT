import { useEffect, useRef } from 'react';
import { Modal } from './ui.jsx';

// Approval gate: read tools auto-run; write/exec tools always land here.
// Allow once -> single call. Always allow -> persisted in keychain-side store.
// Esc = deny (safe default). Focus lands on Allow once.
export default function ToolApproval({ pending, onResolve }) {
  const firstBtn = useRef(null);
  useEffect(() => {
    if (!pending) return;
    firstBtn.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onResolve({ denied: true }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending]); // eslint-disable-line
  if (!pending) return null;
  const { serverId, name, args, risk } = pending;
  async function decide(choice) {
    if (choice === 'always' && window.codeit?.toolsAlwaysAllow) {
      await window.codeit.toolsAlwaysAllow(`${serverId}.${name}`);
    }
    onResolve(choice === 'deny' ? { denied: true } : { approved: choice });
  }
  return (
    <Modal title={`⚠️ Tool approval${risk === 'write' ? ' (write)' : ''}`} guard>
      <div style={{ fontSize: 13, marginBottom: 6 }}><code>{serverId}.{name}</code></div>
      <pre>{JSON.stringify(args || {}, null, 2).slice(0, 2000)}</pre>
      <div className="row">
        <button ref={firstBtn} className="btn btn-primary" onClick={() => decide('once')}>Allow once</button>
        <button className="btn" onClick={() => decide('always')}>Always allow</button>
        <button className="btn btn-danger" onClick={() => decide('deny')}>Deny</button>
      </div>
    </Modal>
  );
}
