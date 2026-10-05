import { useEffect, useState } from 'react';
import { Empty } from './ui.jsx';

// Keyboard-operable file tree: arrows move, Enter opens files.
function Tree({ nodes, onOpen, depth = 0 }) {
  if (!nodes) return null;
  return (
    <div role={depth === 0 ? 'tree' : 'group'} style={{ marginLeft: depth ? 12 : 0 }} className="tree">
      {nodes.map((n) => (
        <div key={n.path} role="treeitem" aria-expanded={n.type === 'dir' ? true : undefined}>
          <button className={`tree-row ${n.type}`} style={{ paddingLeft: 6 }}
            onClick={() => n.type === 'file' && onOpen(n)}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && n.type === 'file') { e.preventDefault(); onOpen(n); } }}
            aria-label={`${n.type} ${n.name}`}>
            {n.type === 'dir' ? '📁' : '📄'} {n.name}
          </button>
          {n.children && <Tree nodes={n.children} onOpen={onOpen} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

export default function FileExplorer({ onOpenFile, root, setRoot, refreshKey, activePath }) {
  const [tree, setTree] = useState([]);
  async function refresh() {
    if (!window.codeit) return;
    const res = await window.codeit.fsList();
    setRoot(res.root);
    setTree(res.tree || []);
  }
  useEffect(() => { refresh(); }, [refreshKey, activePath]); // eslint-disable-line
  return (
    <div className="pane-body scroll pad">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn btn-sm" onClick={async () => { await window.codeit?.openWorkspace(); refresh(); }}>Open folder</button>
        <button className="btn btn-sm btn-ghost" onClick={refresh} title="Refresh">↻</button>
      </div>
      <div className="sub" style={{ marginBottom: 6, wordBreak: 'break-all', fontSize: 11, color: 'var(--dim)' }}>{root}</div>
      {!window.codeit
        ? <Empty>File tree needs Electron (`npm run dev`). Web preview shows chat only.</Empty>
        : <Tree nodes={tree} onOpen={onOpenFile} />}
    </div>
  );
}
