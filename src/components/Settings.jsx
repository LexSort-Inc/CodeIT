import { useState } from 'react';
import { PROVIDERS, getKeys, setKey } from '../llm/router.js';

export default function Settings({ provider, setProvider, model, setModel }) {
  const [keys, setKeysState] = useState(getKeys());
  const [show, setShow] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(PROVIDERS.find((p) => p.id === e.target.value).models[0]); }}>
        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {PROVIDERS.find((p) => p.id === provider).models.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <button onClick={() => setShow(!show)}>Keys</button>
      {show && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', border: '1px solid #333', padding: 6, borderRadius: 6 }}>
          {['gemini', 'groq', 'deepseek', 'openrouter'].map((k) => (
            <label key={k} style={{ fontSize: 12 }}>{k}
              <input type="password" value={keys[k] || ''} placeholder="free key"
                onChange={(e) => { const v = e.target.value; setKey(k, v); setKeysState({ ...keys, [k]: v }); }}
                style={{ width: 110, marginLeft: 4 }} />
            </label>
          ))}
          <span style={{ fontSize: 11, opacity: 0.7 }}>Ollama needs no key. Keys stay in this machine only.</span>
        </div>
      )}
    </div>
  );
}
