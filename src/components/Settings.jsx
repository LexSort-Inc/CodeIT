import { useEffect, useState } from 'react';
import { PROVIDERS, getKeys, setKey } from '../llm/router.js';
import { KEY_LINKS } from '../llm/models.js';

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
  const [show, setShow] = useState(false);
  const [secured, setSecured] = useState(false);
  useEffect(() => {
    getKeys().then((k) => { setKeysState(k); setSecured(Boolean(window.codeit?.keysGet)); });
  }, []);
  const info = PROVIDERS.find((p) => p.id === provider);
  const keysSet = KEY_FIELDS.some((f) => keys[f.id]);
  return (
    <div className="row" title="Defaults for new threads — each thread keeps its own model">
      <span className="muted" style={{ fontSize: 11 }}>Defaults</span>
      <select aria-label="Default provider for new threads" value={provider} onChange={(e) => { setProvider(e.target.value); setModel(PROVIDERS.find((p) => p.id === e.target.value).models[0]); }}>
        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}{p.supportsTools ? '' : ' (no tools)'}</option>)}
      </select>
      <select aria-label="Default model for new threads" value={model} onChange={(e) => setModel(e.target.value)}>
        {PROVIDERS.find((p) => p.id === provider).models.map((m) => <option key={m} value={m}>{m}</option>)}
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
            <label key={f.id} style={{ fontSize: 12 }}>{f.label}
              <input type="password" value={keys[f.id] || ''} placeholder="free key" autoComplete="off"
                onChange={async (e) => { const v = e.target.value; await setKey(f.id, v); setKeysState({ ...keys, [f.id]: v }); }}
                style={{ width: 110, marginLeft: 4 }} />
              {KEY_LINKS[f.id] && (
                <a href={KEY_LINKS[f.id].url} target="_blank" rel="noreferrer" title={`Get ${f.label} key — ${KEY_LINKS[f.id].note}`}
                  style={{ fontSize: 11, marginLeft: 4 }}>Get key ⧉</a>
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
