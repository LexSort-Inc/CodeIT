import { useState } from 'react';
import { streamChat } from '../llm/router.js';

const SYS = 'You are CodeIT, a local-first coding assistant. Be concise. When asked to edit code, output the full replacement file content in a ``` code fence.';

export default function ChatPane({ provider, model, fileContext }) {
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: 'CodeIT ready. Ollama default `qwen2.5-coder:7b`. Attach file context with the +File button (reads active editor).' }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const withCtx = fileContext
      ? `${text}\n\n--- FILE CONTEXT (${fileContext.path}) ---\n${fileContext.content.slice(0, 12000)}`
      : text;
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
