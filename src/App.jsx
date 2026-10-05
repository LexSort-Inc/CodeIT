import { useRef, useState, useEffect } from 'react';
import ChatPane from './components/ChatPane.jsx';
import FileExplorer from './components/FileExplorer.jsx';
import TerminalPane from './components/TerminalPane.jsx';
import WebviewDock from './components/WebviewDock.jsx';
import Settings from './components/Settings.jsx';
import './styles.css';

export default function App() {
  const [provider, setProvider] = useState('ollama');
  const [model, setModel] = useState('qwen2.5-coder:7b');
  const [file, setFile] = useState(null);
  const [fileContext, setFileContext] = useState(null);
  const [root, setRoot] = useState('');
  const [rightTab, setRightTab] = useState('terminal'); // terminal | web
  const editorOpenRef = useRef(null);

  return (
    <div className="app">
      <header className="topbar">
        <strong>CodeIT</strong>
        <span className="muted">local-first workspace</span>
        <span style={{ flex: 1 }} />
        <Settings provider={provider} setProvider={setProvider} model={model} setModel={setModel} />
      </header>
      <div className="grid">
        <section className="pane">
          <div className="pane-title">Chat — {provider}/{model} {fileContext ? `· +${fileContext.path.split('/').pop()}` : ''}</div>
          <div className="pane-body"><ChatPane provider={provider} model={model} fileContext={fileContext} /></div>
        </section>
        <section className="pane">
          <div className="pane-title">Files {root ? `· ${root}` : ''}</div>
          <div className="pane-body">
            <FileExplorer root={root} setRoot={setRoot} onOpenFile={(f) => { setFile(f); editorOpenRef.current?.(f); }} />
          </div>
          <div className="pane-title">Editor</div>
          <div className="pane-body editor">
            <EditorPaneInner file={file} setFile={setFile} onAttach={setFileContext} openRef={editorOpenRef} />
          </div>
        </section>
        <section className="pane">
          <div className="pane-title tabs">
            <button onClick={() => setRightTab('terminal')} className={rightTab === 'terminal' ? 'active' : ''}>Terminal</button>
            <button onClick={() => setRightTab('web')} className={rightTab === 'web' ? 'active' : ''}>Web dock</button>
          </div>
          <div className="pane-body">{rightTab === 'terminal' ? <TerminalPane /> : <WebviewDock />}</div>
        </section>
      </div>
    </div>
  );
}

// small wrapper so FileExplorer can trigger editor open via ref
function EditorPaneInner(props) {
  return <EditorPaneWithRef {...props} />;
}
function EditorPaneWithRef({ openRef, ...rest }) {
  const [file, setFile] = [rest.file, rest.setFile];
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    openRef.current = async (f) => {
      setFile(f);
      if (window.codeit) setContent(await window.codeit.fsRead(f.path));
    };
  }, []);
  async function save() {
    if (!file || !window.codeit) return;
    await window.codeit.fsWrite(file.path, content);
    setStatus(`Saved ${new Date().toLocaleTimeString()}`);
    setTimeout(() => setStatus(''), 2000);
  }
  void 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: 6, borderBottom: '1px solid #30363d', alignItems: 'center' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{file ? file.path : 'No file — pick one from explorer'}</span>
        <span style={{ flex: 1 }} />
        {file && <button onClick={() => rest.onAttach({ path: file.path, content })}>+File to chat</button>}
        {file && <button onClick={save}>Save</button>}
        {status && <span style={{ fontSize: 12, color: '#3fb950' }}>{status}</span>}
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="// open a file to edit"
        spellCheck={false} style={{ flex: 1, background: '#0d1117', color: '#e6edf3', border: 0, padding: 10, fontFamily: 'ui-monospace,monospace', fontSize: 13, resize: 'none' }} />
    </div>
  );
}
