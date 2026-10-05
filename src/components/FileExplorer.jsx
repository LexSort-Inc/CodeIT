import { useEffect, useState } from 'react';

function Tree({ nodes, onOpen, depth = 0 }) {
  if (!nodes) return null;
  return (
    <div style={{ marginLeft: depth ? 12 : 0 }}>
      {nodes.map((n) => (
        <div key={n.path}>
          <div onClick={() => n.type === 'file' && onOpen(n)} style={{ cursor: n.type === 'file' ? 'pointer' : 'default', fontSize: 13, padding: '2px 4px', opacity: n.type === 'file' ? 1 : 0.8 }}>
            {n.type === 'dir' ? `📁 ${n.name}` : `📄 ${n.name}`}
          </div>
          {n.children && <Tree nodes={n.children} onOpen={onOpen} depth={depth + 1} />}
        </div>
      ))}
    </div>
  );
}

export default function FileExplorer({ onOpenFile, root, setRoot }) {
  const [tree, setTree] = useState([]);
  async function refresh() {
    if (!window.codeit) return;
    const res = await window.codeit.fsList();
    setRoot(res.root);
    setTree(res.tree || []);
  }
  useEffect(() => { refresh(); }, []);
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 8 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button onClick={async () => { await window.codeit?.openWorkspace(); refresh(); }}>Open folder</button>
        <button onClick={refresh}>↻</button>
      </div>
      <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6, wordBreak: 'break-all' }}>{root}</div>
      {!window.codeit
        ? <div style={{ fontSize: 13 }}>File tree needs Electron (run `npm run dev`). Web preview shows chat only.</div>
        : <Tree nodes={tree} onOpen={onOpenFile} />}
    </div>
  );
}
