import { useEffect, useState } from 'react';
import { PROVIDERS, getKeys, setKey } from '../llm/router.js';

const KEY_FIELDS = [
  { id: 'gemini', label: 'gemini' },
  { id: 'groq', label: 'groq' },
  { id: 'deepseek', label: 'deepseek' },
  { id: 'openrouter', label: 'openrouter' },
  { id: 'brave', label: 'brave (search)' }
];

export default function Settings({ provider, setProvider, model, setModel, toolCount }) {
  const [keys, setKeysState] = useState({});
  const [show, setShow] = useState(false);
  const [secured, setSecured] = useState(false);
  useEffect(() => {
    getKeys().then((k) => { setKeysState(k); setSecured(Boolean(window.codeit?.keysGet)); });
  }, []);
  const info = PROVIDERS.find((p) => p.id === provider);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(PROVIDERS.find((p) => p.id === e.target.value).models[0]); }}>
        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}{p.supportsTools ? '' : ' (no tools)'}</option>)}
      </select>
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {PROVIDERS.find((p) => p.id === provider).models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      {toolCount > 0 && (
        <span title={`${toolCount} MCP tools available to ${info.supportsTools ? 'this provider' : 'tool-capable providers (this one is text-only)'}`}
          style={{ fontSize: 12, opacity: info.supportsTools ? 0.9 : 0.5 }}>
          🧰{toolCount}{info.supportsTools ? '' : ' ⚠'}
        </span>
      )}
      <button onClick={() => setShow(!show)}>Keys</button>
      {show && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #333', padding: 6, borderRadius: 6, flexWrap: 'wrap' }}>
          {KEY_FIELDS.map((f) => (
            <label key={f.id} style={{ fontSize: 12 }}>{f.label}
              <input type="password" value={keys[f.id] || ''} placeholder="free key"
                onChange={async (e) => { const v = e.target.value; await setKey(f.id, v); setKeysState({ ...keys, [f.id]: v }); }}
                style={{ width: 110, marginLeft: 4 }} />
            </label>
          ))}
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            {secured ? '🔒 OS keychain. ' : ''}Ollama needs no key. Keys never leave this machine.
          </span>
        </div>
      )}
    </div>
  );
}
