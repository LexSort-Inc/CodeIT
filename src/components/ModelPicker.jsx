import { useEffect, useRef, useState } from 'react';
import { allModels, setLiveModels } from '../llm/models.js';
import { refreshProviderModels, PROVIDERS } from '../llm/router.js';

// Per-thread model menu: searchable, grouped, with a fact panel
// (provider / inputs / reasoning / context) like OpenCode Zen's picker.
const VEIL = { position: 'fixed', inset: 0, zIndex: 60 };
const MENU = {
  position: 'absolute', zIndex: 61, top: '110%', left: 0, display: 'flex',
  background: 'var(--bg1, #161b22)', border: '1px solid var(--line, #30363d)',
  borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 32px #000a',
};
const ROW = {
  display: 'flex', gap: 6, width: '100%', textAlign: 'left', fontSize: 12,
  padding: '5px 8px', border: 0, borderRadius: 0, background: 'transparent',
  color: 'inherit', cursor: 'pointer',
};

export default function ModelPicker({ provider, model, onPick }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState('');
  const inputRef = useRef(null);

  async function refreshLive() {
    setRefreshing(true);
    setRefreshMsg('');
    let ok = 0;
    let firstErr = '';
    for (const p of PROVIDERS) {
      if (p.id === 'opencode' || p.id === 'anthropic') continue;
      try {
        const ids = await refreshProviderModels(p.id);
        if (ids.length) { setLiveModels(p.id, ids); ok++; }
      } catch (err) { if (!firstErr) firstErr = `${p.id}: ${String(err.message).slice(0, 80)}`; }
    }
    setRefreshMsg(ok ? `Live lists updated (${ok} providers)` : (firstErr || 'Refresh failed'));
    setRefreshing(false);
  }
  const list = allModels();
  const items = list.filter((m) => {
    const s = q.trim().toLowerCase();
    return !s || `${m.model} ${m.provider}`.toLowerCase().includes(s);
  });

  useEffect(() => { if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { setIdx(0); }, [q]);

  function pick(m) {
    if (!m) return;
    onPick(m.provider, m.model);
    setOpen(false);
  }

  function onKey(e) {
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && items[idx]) pick(items[idx]);
  }

  const sel = items[idx];
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-sm" onClick={() => setOpen(!open)} title={`${provider}/${model} — pick model for this thread`} aria-haspopup="listbox" aria-expanded={open}>
        {provider === 'opencode' ? '🤖 ' : ''}{String(model).length > 24 ? String(model).slice(0, 23) + '…' : model} ▾
      </button>
      {open && (
        <>
          <div style={VEIL} onMouseDown={() => setOpen(false)} />
          <div role="listbox" aria-label="Pick model" style={MENU}>
            <div style={{ width: 250, display: 'flex', flexDirection: 'column', maxHeight: 320 }}>
              <div style={{ display: 'flex', gap: 4, margin: 6 }}>
                <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
                  placeholder="Search models" aria-label="Search models" style={{ flex: 1, margin: 0 }} />
                <button className="btn btn-sm" onClick={refreshLive} disabled={refreshing}
                  title="Fetch live model lists (Ollama + keyed providers)">↻</button>
              </div>
              {(refreshing || refreshMsg) && <div className="muted" style={{ fontSize: 11, padding: '0 8px 4px' }}>{refreshing ? 'Refreshing…' : refreshMsg}</div>}
              <div style={{ overflowY: 'auto', flex: 1 }} onKeyDown={onKey}>
                {items.map((m, i) => (
                  <button key={`${m.provider}/${m.model}`} role="option" aria-selected={i === idx}
                    onMouseEnter={() => setIdx(i)} onClick={() => pick(m)}
                    style={{ ...ROW, background: i === idx ? '#1f6feb33' : 'transparent' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.agent ? '🤖 OpenCode agent' : m.model}</span>
                    {m.local && <span className="k">Local</span>}
                    {m.free && !m.local && <span className="k">Free</span>}
                  </button>
                ))}
                {items.length === 0 && <div className="empty">No models match.</div>}
              </div>
            </div>
            <div style={{ width: 170, borderLeft: '1px solid var(--line, #30363d)', padding: 10, fontSize: 12 }}>
              {sel ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><div className="muted">Model</div><strong>{sel.agent ? 'OpenCode agent' : sel.model}</strong></div>
                  <div><div className="muted">Provider</div>{sel.provider === 'ollama' ? 'Ollama (local)' : sel.provider === 'opencode' ? 'OpenCode' : sel.provider}</div>
                  <div><div className="muted">Inputs</div>text</div>
                  <div><div className="muted">Reasoning</div>{sel.reasoning ? 'Allows reasoning' : '—'}</div>
                  <div><div className="muted">Context</div>{sel.context == null ? 'varies' : sel.context.toLocaleString()}</div>
                  <div><div className="muted">Tools</div>{sel.tools ? (sel.agent ? 'agent tools' : 'MCP tools') : 'text-only'}</div>
                  <div><div className="muted">Key</div>{sel.local ? 'none (local)' : sel.agent ? 'opencode auth' : 'API key in Keys'}</div>
                </div>
              ) : <span className="muted">Pick a model</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
