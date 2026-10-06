import { useEffect, useState } from 'react';
import { PROVIDERS, getKeys, setKey, testProviderKey } from '../llm/router.js';
import { KEY_LINKS } from '../llm/models.js';
import { modelsForSelect } from '../llm/store.js';

const KEY_FIELDS = [
  { id: 'gemini', label: 'gemini' },
  { id: 'groq', label: 'groq' },
  { id: 'deepseek', label: 'deepseek' },
  { id: 'openrouter', label: 'openrouter' },
  { id: 'anthropic', label: 'anthropic (claude)' },
  { id: 'brave', label: 'brave (search)' }
];

// App-level selects are DEFAULTS for new threads; each thread has its own picker.
export default function Settings({ provider, setProvider, model, setModel, toolCount }) {
  const [keys, setKeysState] = useState({});
  const [show, setShow] = useState(false); // first-run keys live in the setup guide
  const [secured, setSecured] = useState(false);
  const [tests, setTests] = useState({}); // id -> { phase, msg }

  async function testKey(id) {
    setTests((t) => ({ ...t, [id]: { phase: 'testing', msg: 'testing…' } }));
    const r = await testProviderKey(id);
    setTests((t) => ({ ...t, [id]: r.ok ? { phase: 'ok', msg: `✓ ${r.detail}` } : { phase: 'err', msg: r.error } }));
  }
  useEffect(() => {
    getKeys().then((k) => {
      setKeysState(k);
      setSecured(Boolean(window.codeit?.keysGet));
    });
  }, []);
  const info = PROVIDERS.find((p) => p.id === provider);
  const keysSet = KEY_FIELDS.some((f) => keys[f.id]);
  return (
    <div className="row" title="Defaults for new threads — each thread keeps its own model">
      <span className="muted" style={{ fontSize: 11 }}>Defaults</span>
      <select aria-label="Default provider for new threads" value={provider} onChange={(e) => setProvider(e.target.value)}>
        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}{p.supportsTools ? '' : ' (no tools)'}</option>)}
      </select>
      <select aria-label="Default model for new threads" value={model} onChange={(e) => setModel(e.target.value)}>
        {modelsForSelect(provider, model).map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      {toolCount > 0 && (
        <span title={`${toolCount} MCP tools available to ${info.supportsTools ? 'this provider' : 'tool-capable providers (this one is text-only)'}`}
          style={{ fontSize: 12, opacity: info.supportsTools ? 0.9 : 0.5 }}>
          🧰{toolCount}{info.supportsTools ? '' : ' ⚠'}
        </span>
      )}
      <button className="btn btn-sm" onClick={() => setShow(!show)} aria-expanded={show}>Keys{keysSet ? ' ●' : ''}</button>
      {show && (
        <div className="card row" style={{ flexWrap: 'wrap' }}>
          {KEY_FIELDS.map((f) => (
            <label key={f.id} style={{ fontSize: 12 }} title={keys[f.id] ? 'Saved ✓ — type to replace, clear to remove' : `Paste ${f.label} key — saves automatically`}>
              {f.label} {keys[f.id] ? <span style={{ color: '#3fb950' }} title="Key saved">✓</span> : null}
              <input type="password" value={keys[f.id] || ''} placeholder="paste key — saves as you type" autoComplete="off"
                onChange={async (e) => { const v = e.target.value; await setKey(f.id, v); setKeysState({ ...keys, [f.id]: v }); }}
                style={{ width: 130, marginLeft: 4 }} />
              {KEY_LINKS[f.id] && (
                <a href={KEY_LINKS[f.id].url} target="_blank" rel="noreferrer" title={`Get ${f.label} key — ${KEY_LINKS[f.id].note}`}
                  style={{ fontSize: 11, marginLeft: 4 }}>Get key ⧉</a>
              )}
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 4 }} disabled={!keys[f.id] || tests[f.id]?.phase === 'testing'}
                onClick={() => testKey(f.id)} title={`Send a minimal live call to verify the ${f.label} key`}>
                {tests[f.id]?.phase === 'testing' ? '…' : 'Test'}
              </button>
              {tests[f.id] && tests[f.id].phase !== 'testing' && (
                <span style={{ fontSize: 11, marginLeft: 4, color: tests[f.id].phase === 'ok' ? '#3fb950' : '#f85149' }}
                  title={tests[f.id].phase === 'ok' ? tests[f.id].msg : tests[f.id].msg}>
                  {tests[f.id].phase === 'ok' ? tests[f.id].msg : `✕ ${tests[f.id].msg.slice(0, 90)}`}
                </span>
              )}
            </label>
          ))}
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {secured ? '🔒 OS keychain. ' : ''}Ollama needs no key. Keys never leave this machine.
          </span>
        </div>
      )}
    </div>
  );
}
