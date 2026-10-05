import { useEffect, useRef, useState } from 'react';

// Shared chrome: one tab style, one toolbar, one menu, one modal shell.
// Frozen contract: change these, not per-component inline styles.

export function Tabs({ tabs, active, onChange, labels }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={active === t} className={active === t ? 'active' : ''}
          onClick={() => onChange(t)}>{labels ? labels[t] : t}</button>
      ))}
    </div>
  );
}

export function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>;
}

export function Badge({ color, children }) {
  return <span className={`badge${color ? ` ${color}` : ''}`}>{children}</span>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

// Overflow menu: Reveal/Rename/Remove etc. Esc closes, focus stays manageable.
export function Menu({ label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open ]);
  return (
    <span className="menu-wrap" ref={ref}>
      <button className="btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{label || '…'}</button>
      {open && <div className="menu" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </span>
  );
}

// Modal shell with red/guard styling for approvals, neutral otherwise.
export function Modal({ title, children, guard }) {
  return (
    <div className="modal-veil">
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title} style={guard ? undefined : { borderColor: 'var(--line)' }}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
