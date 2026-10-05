import { useEffect, useRef, useState } from 'react';

// Cmd/Ctrl+K command palette: actions + thread/model jumping wired by parent.
export default function CommandPalette({ actions, onClose }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const items = (actions || []).filter((a) => !q.trim() || a.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setIdx(0); }, [q]);
  function onKey(e) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && items[idx]) { items[idx].run(); onClose(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      const zen = (actions || []).find((a) => a.id === 'zen');
      if (zen) { zen.run(); onClose(); }
    }
  }
  return (
    <div className="palette-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Type a command… (Esc closes, ⌘K Z toggles zen)" aria-label="Command palette" />
        <div className="palette-list" role="listbox">
          {items.map((a, i) => (
            <button key={a.id} role="option" aria-selected={i === idx}
              className={`palette-item${i === idx ? ' active' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => { a.run(); onClose(); }}>
              {a.label}{a.hint && <span className="k">{a.hint}</span>}
            </button>
          ))}
          {items.length === 0 && <div className="empty">No matching commands.</div>}
        </div>
      </div>
    </div>
  );
}
