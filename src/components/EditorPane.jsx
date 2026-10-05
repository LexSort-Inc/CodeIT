import { useState } from 'react';

export default function EditorPane({ file, setFile, onAttach }) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');

  async function open(f) {
    setFile(f);
    if (!window.codeit) return;
    setContent(await window.codeit.fsRead(f.path));
  }

  EditorPane.open = open; // wired from App via ref callback

  async function save() {
    if (!file || !window.codeit) return;
    await window.codeit.fsWrite(file.path, content);
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    setTimeout(() => setStatus(''), 2000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid #30363d', alignItems: 'center' }}>
        <span style={{ fontSize: 12, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>{file ? file.path : 'No file — pick one from explorer'}</span>
        <span style={{ flex: 1 }} />
        {file && <button onClick={() => onAttach({ path: file.path, content })}>+File to chat</button>}
        {file && <button onClick={save}>Save</button>}
        {status && <span style={{ fontSize: 12, color: '#3fb950' }}>{status}</span>}
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="// open a file to edit"
        spellCheck={false} style={{ flex: 1, background: '#0d1117', color: '#e6edf3', border: 0, padding: 10, fontFamily: 'ui-monospace,monospace', fontSize: 13, resize: 'none' }} />
    </div>
  );
}
