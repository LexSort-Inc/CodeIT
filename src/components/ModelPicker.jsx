import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { allModels, setLiveModels, splitReady, deadCount, clearDead } from '../llm/models.js';
import { refreshProviderModels, PROVIDERS, getKeys } from '../llm/router.js';

// Per-thread model menu: searchable, grouped, with a fact panel
// (provider / inputs / reasoning / context) like OpenCode Zen's picker.
// The menu portals to <body> as position:fixed — an earlier invisible
// full-viewport veil (position:fixed inset:0, no background) swallowed every
// click in the app while open, which is why the right-pane tabs "did nothing".
const MENU = {
  position: 'fixed', zIndex: 61, display: 'flex',
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
  const [savedKeys, setSavedKeys] = useState({});
  const [verified, setVerified] = useState(new Set());
  const [anchor, setAnchor] = useState(null); // trigger rect while open
  const inputRef = useRef(null);
  const wrapRef = useRef(null); // trigger wrapper (inside the app)
  const menuRef = useRef(null); // portal'd menu (on body)

  function toggle(e) {
    if (open) { setOpen(false); return; }
    setAnchor(e.currentTarget.getBoundingClientRect());
    setOpen(true);
  }

  // Close on outside mousedown / Escape / resize via real document listeners —
  // no overlay, so every click outside passes through to the app underneath.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function menuPos() {
    if (!anchor) return MENU;
    const W = 424; // 250 list + 170 facts + border
    const H = 440;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8));
    const below = anchor.bottom + 6;
    const above = anchor.top - H - 6;
    const top = below + H > window.innerHeight && above > 8 ? Math.max(8, above) : below;
    return { ...MENU, left, top };
  }
  function onResize() { setOpen(false); }

  useEffect(() => {
    if (!open) return;
    getKeys().then(setSavedKeys).catch(() => {});
    window.codeit?.usageGet?.().then((u) => {
      const s = new Set();
      for (const e of u?.events || []) if (e.ok) s.add(`${e.provider}/${e.model}`);
      setVerified(s);
    }).catch(() => {});
  }, [open]);

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
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && flat[idx]) pick(flat[idx]);
  }

  function row(m) {
    const i = flat.indexOf(m);
    return (
      <button key={`${m.provider}/${m.model}`} role="option" aria-selected={i === idx}
        onMouseEnter={() => setIdx(i)} onClick={() => pick(m)}
        style={{ display: 'flex', gap: 6, width: '100%', textAlign: 'left', fontSize: 12, padding: '5px 8px', border: 0, borderRadius: 0, background: i === idx ? '#1f6feb33' : 'transparent', color: 'inherit', cursor: 'pointer', opacity: showDead && m.dead ? 0.55 : 1 }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.agent ? '🤖 OpenCode agent' : m.model}</span>
        {!showDead && verified.has(`${m.provider}/${m.model}`) && <span title="Answered successfully before" style={{ color: '#3fb950', fontSize: 11 }}>✓</span>}
        {m.tier === 'local' && <span className="k" title="Runs on this machine — no key, no cost">Local</span>}
        {m.tier === 'free' && <span className="k" title="Free tier — needs key, no card">Free</span>}
        {m.tier === 'paid' && <span className="k" title="Paid — needs billing on the provider">Paid</span>}
        {m.needsKey && (savedKeys[m.keyId]
          ? <span title="Key saved ✓" style={{ color: '#3fb950', fontSize: 11 }}>✓</span>
          : <span className="k" title={`Needs ${m.keyId} key — add it in Keys`}>key</span>)}
      </button>
    );
  }

  const [showDead, setShowDead] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [deadN, setDeadN] = useState(0);
  useEffect(() => { if (open) setDeadN(deadCount()); }, [open]);
  const visible = showDead ? allModels(true).filter((m) => {
    const s = q.trim().toLowerCase();
    return !s || `${m.model} ${m.provider}`.toLowerCase().includes(s);
  }) : items;
  const groups = showDead
    ? { working: visible, ready: [], needsKey: [], local: [] }
    : splitReady(visible, savedKeys, verified);
  // Default view: only what can plausibly answer (verified + key-saved).
  // Needs-key, local, and dead models hide behind "Show all".
  // New users have nothing verified and no keys: auto-expand so the menu
  // teaches instead of showing a blank list. Narrows back down once usable.
  const autoAll = !showDead && !showAll && !q.trim() && groups.working.length === 0 && groups.ready.length === 0;
  const listed = showDead || showAll || autoAll
    ? [...groups.working, ...groups.ready, ...groups.needsKey, ...groups.local]
    : [...groups.working, ...groups.ready];
  const flat = listed;
  const sel = flat[idx] ?? null; // never fall back to a different list (fact panel showed the wrong model)
  return (
    <div style={{ position: 'relative' }} ref={wrapRef}>
      <button className="btn btn-sm" onClick={toggle} title={`${provider}/${model} — pick model for this thread`} aria-haspopup="listbox" aria-expanded={open}>
        {provider === 'opencode' ? '🤖 ' : ''}{String(model).length > 24 ? String(model).slice(0, 23) + '…' : model} ▾
      </button>
      {open && anchor && createPortal(
        <div ref={menuRef} role="listbox" aria-label="Pick model" style={menuPos()}>
            <div style={{ width: 250, display: 'flex', flexDirection: 'column', maxHeight: 320 }}>
              <div style={{ display: 'flex', gap: 4, margin: 6 }}>
                <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
                  placeholder="Search models" aria-label="Search models" style={{ flex: 1, margin: 0 }} />
                <button className="btn btn-sm" onClick={refreshLive} disabled={refreshing}
                  title="Fetch live model lists (Ollama + keyed providers)">↻</button>
              </div>
              {(refreshing || refreshMsg) && <div className="muted" style={{ fontSize: 11, padding: '0 8px 4px' }}>{refreshing ? 'Refreshing…' : refreshMsg}</div>}
              <div style={{ overflowY: 'auto', flex: 1 }} onKeyDown={onKey}>
                {!showDead && groups.working.length > 0 && <div className="muted" style={{ fontSize: 10, padding: '4px 8px 0', textTransform: 'uppercase' }}>✓ Verified working</div>}
                {!showDead && groups.working.map(row)}
                {!showDead && groups.ready.length > 0 && <div className="muted" style={{ fontSize: 10, padding: '4px 8px 0', textTransform: 'uppercase' }}>Ready — untested</div>}
                {!showDead && groups.ready.map(row)}
                {!showDead && (showAll || autoAll) && groups.needsKey.length > 0 && <div className="muted" style={{ fontSize: 10, padding: '4px 8px 0', textTransform: 'uppercase' }}>Needs key — add in Keys, then Test</div>}
                {!showDead && (showAll || autoAll) && groups.needsKey.map(row)}
                {!showDead && (showAll || autoAll) && groups.local.length > 0 && <div className="muted" style={{ fontSize: 10, padding: '4px 8px 0', textTransform: 'uppercase' }}>Local models</div>}
                {!showDead && (showAll || autoAll) && groups.local.map(row)}
                {showDead && flat.map(row)}
                {flat.length === 0 && <div className="empty">No models match.</div>}
                {!showDead && (
                  <div style={{ padding: '4px 8px', fontSize: 11 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setShowAll(!showAll)} title="Show models that need a key, local models, and anything else">
                      {showAll ? 'Show working only' : 'Show all'}
                    </button>
                  </div>
                )}
                {!showDead && deadN > 0 && (
                  <div style={{ padding: '4px 8px', fontSize: 11 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setShowDead(true)}>{deadN} not working — show</button>
                    <button className="btn btn-sm btn-ghost" style={{ marginLeft: 4 }} onClick={() => { clearDead(); setDeadN(0); }} title="Forget the not-working list">clear</button>
                  </div>
                )}
                {showDead && (
                  <div style={{ padding: '4px 8px', fontSize: 11 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setShowDead(false)}>hide not-working</button>
                    <button className="btn btn-sm btn-ghost" style={{ marginLeft: 4 }} onClick={() => { clearDead(); setDeadN(0); setShowDead(false); }}>clear list</button>
                  </div>
                )}
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
                  <div><div className="muted">Key</div>{sel.local ? 'none (local)' : sel.agent ? 'opencode auth' : (savedKeys[sel.keyId] ? 'saved ✓' : 'API key in Keys')}</div>
                  <div><div className="muted">Cost</div>{sel.tier === 'local' ? 'FREE (own hardware)' : sel.tier === 'free' ? 'FREE tier' : 'Paid API'}</div>
                </div>
              ) : <span className="muted">Pick a model</span>}
            </div>
          </div>,
        document.body
      )}
    </div>
  );
}
