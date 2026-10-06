import { useEffect, useState } from 'react';
import { getKeys, setKey, testProviderKey } from '../llm/router.js';
import { KEY_LINKS } from '../llm/models.js';

// First-run guide: one free key → first green reply in under 3 minutes.
// Modal but never trap: Skip and Start both dismiss; reopening is available
// from the command palette ("Open setup guide"). Keys paste-save as you type,
// exactly like the Keys panel in the topbar.
const FOCUS = [
  { id: 'groq', label: 'Groq', note: 'fast · free tier' },
  { id: 'gemini', label: 'Gemini', note: 'free tier' },
  { id: 'openrouter', label: 'OpenRouter', note: 'free models' },
];

export default function Onboarding({ onClose }) {
  const [keys, setKeysState] = useState({});
  const [tests, setTests] = useState({}); // id -> { phase, msg }

  useEffect(() => { getKeys().then(setKeysState).catch(() => {}); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function testKey(id) {
    setTests((t) => ({ ...t, [id]: { phase: 'testing', msg: 'testing…' } }));
    const r = await testProviderKey(id);
    setTests((t) => ({ ...t, [id]: r.ok ? { phase: 'ok', msg: `✓ ${r.detail}` } : { phase: 'err', msg: r.error } }));
  }

  const anyKey = Object.values(keys).some((v) => v);
  const anyOk = Object.values(tests).some((t) => t.phase === 'ok');

  return (
    <div className="onboard-veil" role="dialog" aria-modal="true" aria-label="Welcome to CodeIT">
      <div className="card onboard-card">
        <h2>Welcome to CodeIT</h2>
        <p className="muted">
          Multi-model vibe coding — Build and QA side by side. Keys go straight into this
          machine’s OS keychain and are never sent anywhere but the provider you choose.
        </p>
        <ol className="onboard-steps">
          <li><strong>Grab a free key</strong> — Groq is fastest, Gemini is generous. Both need no credit card.</li>
          <li><strong>Paste it below</strong> — saves as you type.</li>
          <li><strong>Test, then chat</strong> — press <em>Start chatting</em> and ask something.</li>
        </ol>
        <div className="onboard-keys">
          {FOCUS.map((f) => (
            <label key={f.id} className="onboard-key">
              <span className="onboard-keyname">{f.label} <span className="muted" style={{ fontWeight: 400 }}>· {f.note}</span></span>
              <span className="row" style={{ gap: 6 }}>
                <input type="password" value={keys[f.id] || ''} placeholder="paste key — saves automatically"
                  autoComplete="off" aria-label={`${f.label} API key`}
                  onChange={async (e) => { const v = e.target.value; await setKey(f.id, v); setKeysState({ ...keys, [f.id]: v }); }} />
                <button className="btn btn-sm" disabled={!keys[f.id] || tests[f.id]?.phase === 'testing'}
                  onClick={() => testKey(f.id)} title={`Verify the ${f.label} key with a minimal live call`}>
                  {tests[f.id]?.phase === 'testing' ? '…' : 'Test'}
                </button>
                {KEY_LINKS[f.id] && (
                  <a href={KEY_LINKS[f.id].url} target="_blank" rel="noreferrer" title={`Get ${f.label} key — ${KEY_LINKS[f.id].note}`}>Get key ⧉</a>
                )}
              </span>
              {tests[f.id] && tests[f.id].phase !== 'testing' && (
                <span className={tests[f.id].phase === 'ok' ? 'onboard-ok' : 'onboard-err'}>
                  {tests[f.id].phase === 'ok' ? tests[f.id].msg : `✕ ${String(tests[f.id].msg).slice(0, 110)}`}
                </span>
              )}
            </label>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          No key? Local Ollama models (last in the picker) and the OpenCode agent run without one —
          everything else needs a key above. More keys live under <strong>Keys</strong> in the topbar.
        </div>
        <div className="row onboard-actions">
          <button className="btn btn-ghost" onClick={onClose} title="Dismiss — add keys later from Keys in the topbar">Skip for now</button>
          <span className="spacer" />
          {anyOk && <span className="onboard-ready" title="Key verified">✓ verified — ready to chat</span>}
          <button className="btn btn-primary" onClick={onClose} disabled={!anyKey && !anyOk}
            title={anyKey ? 'Close this guide and start chatting' : 'Paste a key first — or press Skip for now'}>
            Start chatting →
          </button>
        </div>
      </div>
    </div>
  );
}
