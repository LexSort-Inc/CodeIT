import { useEffect, useRef, useState } from 'react';
import { streamChat, chatWithTools, getEnabledMcpTools, PROVIDERS, ollamaToolCapable } from '../llm/router.js';
import { matchSkills, buildSystemPrompt } from '../projects/context.js';
import ToolApproval from './ToolApproval.jsx';

const WELCOME = 'CodeIT ready. Ollama default `qwen2.5-coder:7b`. Attach file context with the +File button, pin files, or enable tools in Extensions.';

function chatKey(projectId) {
  return `codeit.chat.${projectId || 'default'}`;
}

function mcpResultToText(result) {
  if (!result) return '(empty result)';
  if (typeof result === 'string') return result;
  try {
    const c = result.content;
    if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p.text || JSON.stringify(p))).join('\n').slice(0, 8000);
    return JSON.stringify(result).slice(0, 8000);
  } catch { return '(unreadable result)'; }
}

export default function ChatPane({ provider, model, fileContext, project, projectNotes, onToolCount }) {
  const projectId = project?.id || 'default';
  const [msgs, setMsgs] = useState([{ role: 'assistant', content: WELCOME }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // approval dialog state
  const [toolLog, setToolLog] = useState([]);
  const [skills, setSkills] = useState([]);
  const [enabledSkillIds, setEnabledSkillIds] = useState(new Set());
  const [mcpTools, setMcpTools] = useState([]);
  const saveTimer = useRef(null);
  const approvalResolve = useRef(null);

  // load per-project history
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
    })();
  }, [projectId]);

  // load skills + enabled MCP tools for this project
  useEffect(() => {
    (async () => {
      if (!window.codeit) return;
      const [sk, catalog] = await Promise.all([window.codeit.skillsList(), window.codeit.toolsCatalog()]);
      setSkills(sk);
      const enabled = new Set(catalog.filter((c) => c.kind === 'skill' && c.enabled).map((c) => c.id));
      // catalog trigger phrases attach for matching
      const byId = Object.fromEntries(catalog.map((c) => [c.id, c]));
      setSkills(sk.map((s) => ({ ...s, triggers: byId[s.id]?.triggers || [] })));
      setEnabledSkillIds(enabled);
      const tools = await getEnabledMcpTools();
      setMcpTools(tools);
      onToolCount?.(tools.length);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
    setToolLog([]);
    if (window.codeit?.projectsSaveChat) window.codeit.projectsSaveChat(projectId, fresh);
  }

  function resolveApproval(decision) {
    approvalResolve.current?.(decision);
    approvalResolve.current = null;
    setPending(null);
  }

  async function executeTool({ serverId, name, args }) {
    let r = await window.codeit.toolsCall(serverId, name, args);
    if (r.needsApproval) {
      const decision = await new Promise((resolve) => {
        approvalResolve.current = resolve;
        setPending({ serverId, name, args, risk: r.risk });
      });
      if (decision?.denied) return 'User denied this action. Continue without it.';
      r = await window.codeit.toolsCall(serverId, name, args, decision.approved);
    }
    if (!r.ok) return `Tool error: ${(r.error || 'unknown').slice(0, 1000)}`;
    return mcpResultToText(r.result);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    // gather project context: pinned files + skill match
    let pinsText = '';
    if (project?.pinned?.length && window.codeit?.fsRead) {
      const parts = [];
      for (const p of project.pinned.slice(0, 5)) {
        try {
          const content = await window.codeit.fsRead(p);
          parts.push(`--- ${p} ---\n${content.slice(0, 6000)}`);
        } catch {}
      }
      pinsText = parts.join('\n\n');
    }
    const matched = matchSkills(skills, text, enabledSkillIds);
    const sys = buildSystemPrompt({ notes: projectNotes, pinsText, skills: matched });
    const withFile = fileContext
      ? `${text}\n\n--- ATTACHED FILE (${fileContext.path}) ---\n${fileContext.content.slice(0, 12000)}`
      : text;

    const next = [...msgs, { role: 'user', content: text }];
    setMsgs(next);
    setInput('');
    setBusy(true);
    setToolLog([]);
    let acc = '';
    setMsgs([...next, { role: 'assistant', content: '' }]);
    const push = (t) => { acc += t; setMsgs((cur) => { const c = [...cur]; c[c.length - 1] = { role: 'assistant', content: acc }; return c; }); };

    try {
      const canUseTools = PROVIDERS.find((p) => p.id === provider)?.supportsTools && mcpTools.length > 0 && window.codeit;
      const history = [{ role: 'system', content: sys }, ...next.map((m) => ({ role: m.role, content: m.content })).slice(-10)];
      history[history.length - 1] = { ...history[history.length - 1], content: withFile };
      if (canUseTools) {
        if (provider === 'ollama' && !ollamaToolCapable(model)) {
          push(`_Note: \`${model}\` doesn't reliably emit tool calls — trying anyway. For reliable local tools switch to \`qwen3:8b\` or \`mistral:7b-instruct-v0.3-q4_0\`, or use Groq._\n\n`);
        }
        await chatWithTools({
          provider, model, messages: history, mcpTools,
          onChunk: push,
          onToolEvent: (e) => setToolLog((l) => [...l, `${e.status === 'calling' ? '⚙️' : '✅'} ${e.serverId}.${e.name}`])
        });
      } else {
        if (mcpTools.length > 0 && !PROVIDERS.find((p) => p.id === provider)?.supportsTools) {
          push(`_Note: ${provider} is text-only here — MCP tools need Ollama/Groq/DeepSeek/OpenRouter. Skills + notes still apply._\n\n`);
        }
        await streamChat({ provider, model, messages: history, onChunk: push });
      }
    } catch (err) {
      const hint = err.code === 'NO_KEY'
        ? String(err.message)
        : `Error: ${err.message} — Tip: run \`ollama serve\` and \`ollama pull ${model}\`, or add a free cloud key.`;
      setMsgs((cur) => { const c = [...cur]; c[c.length - 1] = { role: 'assistant', content: acc ? acc + '\n\n' + hint : hint }; return c; });
    }
    setBusy(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid #30363d', alignItems: 'center' }}>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{project ? `Project: ${project.name}` : 'No project'}</span>
        {mcpTools.length > 0 && <span style={{ fontSize: 11, opacity: 0.8 }}>🧰{mcpTools.length}</span>}
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
        {toolLog.length > 0 && (
          <div style={{ fontSize: 11, opacity: 0.75, border: '1px dashed #30363d', borderRadius: 6, padding: '4px 8px' }}>
            {toolLog.map((t, i) => <div key={i}>{t}</div>)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #30363d' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={`Ask ${model}…`} style={{ flex: 1 }} disabled={busy} />
        <button onClick={send} disabled={busy}>{busy ? '…' : 'Send'}</button>
      </div>
      <ToolApproval pending={pending} onResolve={resolveApproval} />
    </div>
  );
}
