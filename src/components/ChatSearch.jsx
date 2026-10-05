import { useEffect, useRef, useState } from 'react';

// Global chat search: titles, models, and message text across ALL projects.
// Jump restores the thread (even archived) and switches to its project.
export default function ChatSearch({ onClose, onJump }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setIdx(0); }, [results]);

  useEffect(() => {
    clearTimeout(timer.current);
    const query = q.trim();
    if (!query) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      if (window.codeit?.chatsSearch) setResults(await window.codeit.chatsSearch(query));
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q]);

  function go(r) {
    if (!r) return;
    onJump(r);
    onClose();
  }

  function onKey(e) {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[idx]) go(results[idx]);
  }

  return (
    <div className="palette-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search all chats">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Search all chats… (titles, models, message text)" aria-label="Search all chats" />
        <div className="palette-list" role="listbox">
          {results.map((r, i) => (
            <button key={`${r.projectId}:${r.threadId}`} role="option" aria-selected={i === idx}
              className={`palette-item${i === idx ? ' active' : ''}`}
              onMouseEnter={() => setIdx(i)} onClick={() => go(r)}>
              <span>💬 {r.title} <span className="k">{r.projectName} · {r.provider}/{r.model}{r.archived ? ' · archived' : ''}</span></span>
              <span className="k" style={{ display: 'block', whiteSpace: 'normal' }}>{r.snippet}</span>
            </button>
          ))}
          {q.trim() && results.length === 0 && <div className="empty">No chats match.</div>}
          {!q.trim() && <div className="empty">Type to search every project's chats.</div>}
        </div>
      </div>
    </div>
  );
}
