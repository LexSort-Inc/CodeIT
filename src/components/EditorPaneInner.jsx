import { useEffect, useState } from 'react';
import { Toolbar } from './ui.jsx';

// Single editor implementation (replaces dead EditorPane.jsx + App-local copy).
// Toolbar: path | +File to chat | Pin | Save | status. Pinned strip below.
export default function EditorPaneInner({ file, setFile, onAttach, openRef, project, onPinChanged }) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    openRef.current = async (f) => {
      setFile(f);
      if (window.codeit) { try { setContent(await window.codeit.fsRead(f.path)); } catch { setContent(''); } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isPinned = project?.pinned?.includes(file?.path);
  async function save() {
    if (!file || !window.codeit) return;
    try {
      await window.codeit.fsWrite(file.path, content);
      setStatus(`Saved ${new Date().toLocaleTimeString()}`);
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setStatus(`Save failed: ${String((err && err.message) || err).slice(0, 120)}`);
      setTimeout(() => setStatus(''), 6000);
    }
  }
  async function togglePin() {
    if (!project || !file) return;
    if (isPinned) await window.codeit.projectsUnpin(project.id, file.path);
    else await window.codeit.projectsPin(project.id, file.path);
    onPinChanged?.();
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar>
        <span className="path">{file ? file.path : 'No file — pick one from explorer'}</span>
        <span className="spacer" />
        {file && <button className="btn btn-sm" onClick={() => onAttach({ path: file.path, content })}>+File to chat</button>}
        {file && project && <button className="btn btn-sm" onClick={togglePin} title="Pin: always include in project context">{isPinned ? 'Unpin' : 'Pin'}</button>}
        {file && <button className="btn btn-sm btn-primary" onClick={save}>Save</button>}
        {status && <span className="status-ok">{status}</span>}
      </Toolbar>
      {project?.pinned?.length > 0 && (
        <div className="pin-strip">📌 {project.pinned.map((p) => p.split(/[\\/]/).pop()).join(', ')}</div>
      )}
      <label className="sr-only" htmlFor="codeit-editor">File editor</label>
      <textarea id="codeit-editor" className="code-area" value={content} onChange={(e) => setContent(e.target.value)}
        placeholder="// open a file to edit" spellCheck={false} />
    </div>
  );
}
