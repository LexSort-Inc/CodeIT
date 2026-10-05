import { useEffect, useRef, useState } from 'react';
import { streamChat } from '../llm/router.js';

const SYS = 'You are CodeIT, a local-first coding assistant. Be concise. When asked to edit code, output the full replacement file content in a ``` code fence.';
const WELCOME = 'CodeIT ready. Ollama default `qwen2.5-coder:7b`. Attach file context with the +File button (reads active editor).';

function chatKey(projectId) {
  return `codeit.chat.${projectId || 'default'}`;
}

export default function ChatPane({ provider, model, fileContext, project, projectNotes }) {
  const projectId = project?.id || 'default';
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: WELCOME }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef(null);

  // load per-project history on switch
  useEffect(() => {
    (async () => {
      if (window.codeit?.projectsGetChat) {
        const saved = await window.codeit.projectsGetChat(projectId);
        setMsgs(saved.length ? saved : [{ role: 'assistant', content: WELCOME }]);
      } else {
        try {
          const raw = localStorage.getItem(chatKey(projectId));
          setMsgs(raw ? JSON.parse(raw) : [{ role: 'assistant', content: WELCOME }]);
        } catch { setMsgs([{ role: 'assistant', content: WELCOME }]); }
      }
      setFileContextOnSwitch();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function setFileContextOnSwitch() { /* file context is per-message, not persisted */ }

  // persist per-project history (debounced)
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (window.codeit?.projectsSaveChat) window.codeit.projectsSaveChat(projectId, msgs);
      else { try { localStorage.setItem(chatKey(projectId), JSON.stringify(msgs.slice(-100))); } catch {} }
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [msgs, projectId]);

  function clearChat() {
    const fresh = [{ role: 'assistant', content: WELCOME }];
    setMsgs(fresh);
    if (window.codeit?.projectsSaveChat) window.codeit.projectsSaveChat(projectId, fresh);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const withCtx = [
      fileContext ? `--- PINNED FILE (${fileContext.path}) ---\n${fileContext.content.slice(0, 12000)}` : '',
      projectNotes ? `--- PROJECT NOTES ---\n${projectNotes.slice(0, 4000)}` : ''
    ].filter(Boolean).join('\n\n') + (fileContext || projectNotes ? `\n\n--- QUESTION ---\n${text}` : text);
    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    let acc = '';
    setMsgs([...next, { role: 'assistant', content: '' }]);
    try {
      await streamChat({
        provider, model,
        messages: [{ role: 'system', content: SYS }, ...next.map((m) => ({ role: m.role, content: m.content })).slice(-10).map((m, i, a) => (i === a.length - 1 ? { ...m, content: withCtx } : m))],
        onChunk: (t) => { acc += t; setMsgs((cur) => { const c = [...cur]; c[c.length - 1] = { role: 'assistant', content: acc }; return c; }); }
      });
    } catch (err) {
      const hint = err.code === 'NO_KEY'
        ? String(err.message)
        : `Error: ${err.message} — Tip: run \`ollama serve\` and \`ollama pull ${model}\`, or add a free cloud key.`;
      setMsgs((cur) => { const c = [...cur]; c[c.length - 1] = { role: 'assistant', content: hint }; return c; });
    }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid #30363d', alignItems: 'center' }}>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{project ? `Project: ${project.name}` : 'No project'}</span>
        <span style={{ flex: 1 }} />
        <button onClick={clearChat} title="Clear this project's chat history" style={{ fontSize: 12 }}>Clear</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', background: m.role === 'user' ? '#1f6feb22' : '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', fontSize: 13 }}>
            <div style={{ fontSize: 11, opacity: 0.6 }}>{m.role}</div>
            {m.content || (busy && i === msgs.length - 1 ? '…' : '')}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #30363d' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={`Ask ${model}…`} style={{ flex: 1 }} disabled={busy} />
        <button onClick={send} disabled={busy}>{busy ? '…' : 'Send'}</button>
      </div>
    </div>
  );
}
