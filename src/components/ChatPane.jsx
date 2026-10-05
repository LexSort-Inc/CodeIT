import { useEffect, useRef, useState } from 'react';
import { streamChat, chatWithTools, getEnabledMcpTools, PROVIDERS, ollamaToolCapable } from '../llm/router.js';
import { matchSkills, buildSystemPrompt } from '../projects/context.js';
import ToolApproval from './ToolApproval.jsx';

const WELCOME = 'CodeIT ready. Ollama default `qwen2.5-coder:7b`. Attach file context with the +File button, pin files, or enable tools in Extensions.';
const MAX_THREADS = 4;

function chatKey(projectId) {
  return `codeit.chat.${projectId || 'default'}`;
}

function newThread(provider, model, n) {
  return {
    id: `t${Date.now().toString(36)}${n}`,
    provider,
    model,
    msgs: [{ role: 'assistant', content: WELCOME }],
    toolLog: [],
  };
}

function shortModel(m) {
  const s = String(m || '');
  return s.length > 22 ? s.slice(0, 21) + '…' : s;
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
  const [threads, setThreads] = useState(() => [newThread(provider, model, 0)]);
  const [activeId, setActiveId] = useState(() => threads[0].id);
  const [broadcast, setBroadcast] = useState(false);
  const [input, setInput] = useState('');
  const [busyIds, setBusyIds] = useState([]);
  const [pendings, setPendings] = useState({}); // threadId -> approval state
  const [skills, setSkills] = useState([]);
  const [enabledSkillIds, setEnabledSkillIds] = useState(new Set());
  const [mcpTools, setMcpTools] = useState([]);
  const saveTimer = useRef(null);
  const approvalResolve = useRef({});
  const threadCount = useRef(0);

  const active = threads.find((t) => t.id === activeId) || threads[0];

  function patchThread(id, patch) {
    setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // load per-project threads (migrates legacy single-array history)
  useEffect(() => {
    (async () => {
      let saved = null;
      if (window.codeit?.projectsGetChat) saved = await window.codeit.projectsGetChat(projectId);
      else { try { saved = JSON.parse(localStorage.getItem(chatKey(projectId))); } catch { saved = null; } }
      let list = null;
      if (saved && Array.isArray(saved.threads) && saved.threads.length) {
        list = saved.threads.slice(0, MAX_THREADS).map((t) => ({
          ...newThread(t.provider || provider, t.model || model, 0),
          ...t,
          msgs: Array.isArray(t.msgs) && t.msgs.length ? t.msgs : [{ role: 'assistant', content: WELCOME }],
          toolLog: [],
        }));
      } else if (Array.isArray(saved) && saved.length) {
        list = [{ ...newThread(provider, model, 0), msgs: saved }];
      }
      if (list) {
        setThreads(list);
        setActiveId(list[0].id);
      } else {
        const fresh = [newThread(provider, model, 0)];
        setThreads(fresh);
        setActiveId(fresh[0].id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // load skills + enabled MCP tools for this project
  useEffect(() => {
    (async () => {
      if (!window.codeit) return;
      const [sk, catalog] = await Promise.all([window.codeit.skillsList(), window.codeit.toolsCatalog()]);
      setSkills(sk);
      const enabled = new Set(catalog.filter((c) => c.kind === 'skill' && c.enabled).map((c) => c.id));
      const byId = Object.fromEntries(catalog.map((c) => [c.id, c]));
      setSkills(sk.map((s) => ({ ...s, triggers: byId[s.id]?.triggers || [] })));
      setEnabledSkillIds(enabled);
      const tools = await getEnabledMcpTools();
      setMcpTools(tools);
      onToolCount?.(tools.length);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // persist threads (debounced)
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = { threads: threads.map((t) => ({ id: t.id, provider: t.provider, model: t.model, msgs: t.msgs.slice(-100) })) };
      if (window.codeit?.projectsSaveChat) window.codeit.projectsSaveChat(projectId, payload);
      else { try { localStorage.setItem(chatKey(projectId), JSON.stringify(payload)); } catch {} }
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [threads, projectId]);

  function addThread() {
    if (threads.length >= MAX_THREADS) return;
    threadCount.current += 1;
    const t = newThread(provider, model, threadCount.current);
    setThreads((cur) => [...cur, t]);
    setActiveId(t.id);
  }

  function closeThread(id) {
    if (threads.length <= 1) return;
    setThreads((cur) => cur.filter((t) => t.id !== id));
    if (activeId === id) {
      const rest = threads.filter((t) => t.id !== id);
      setActiveId(rest[rest.length - 1].id);
    }
  }

  function clearThread(id) {
    patchThread(id, { msgs: [{ role: 'assistant', content: WELCOME }], toolLog: [] });
  }

  function resolveApproval(threadId, decision) {
    approvalResolve.current[threadId]?.(decision);
    approvalResolve.current[threadId] = null;
    setPendings((p) => { const c = { ...p }; delete c[threadId]; return c; });
  }

  async function executeTool(threadId, { serverId, name, args }) {
    let r = await window.codeit.toolsCall(serverId, name, args);
    if (r.needsApproval) {
      const decision = await new Promise((resolve) => {
        approvalResolve.current[threadId] = resolve;
        setPendings((p) => ({ ...p, [threadId]: { serverId, name, args, risk: r.risk } }));
      });
      if (decision?.denied) return 'User denied this action. Continue without it.';
      r = await window.codeit.toolsCall(serverId, name, args, decision.approved);
    }
    if (!r.ok) return `Tool error: ${(r.error || 'unknown').slice(0, 1000)}`;
    return mcpResultToText(r.result);
  }

  async function runThread(thread, text, pinsText, sys) {
    const tid = thread.id;
    setBusyIds((b) => [...b, tid]);
    patchThread(tid, { toolLog: [] });
    // OpenCode engine: non-interactive agent run in the project dir (own tools + approvals)
    if (thread.provider === 'opencode') {
      const next = [...thread.msgs, { role: 'user', content: text }];
      patchThread(tid, { msgs: [...next, { role: 'assistant', content: '_OpenCode agent running in project dir…_' }] });
      if (!window.codeit?.opencodeRun) {
        patchThread(tid, { msgs: [...next, { role: 'assistant', content: 'Error: OpenCode engine needs Electron (`npm run dev`).' }] });
        setBusyIds((b) => b.filter((id) => id !== tid));
        return;
      }
      const recent = next.slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 2000)}`).join('\n\n');
      const prompt = `${sys}\n\n--- PROJECT NOTES ---\n${projectNotes || '(none)'}\n\n--- PINNED ---\n${pinsText || '(none)'}\n\n--- RECENT ---\n${recent}`;
      const r = await window.codeit.opencodeRun(project?.path || '', thread.model, prompt);
      patchThread(tid, {
        msgs: [...next, { role: 'assistant', content: r.ok ? (r.out || '(empty result)') : `OpenCode error: ${r.error || 'unknown'}` }],
        toolLog: r.ok ? ['🤖 opencode agent run'] : [],
      });
      setBusyIds((b) => b.filter((id) => id !== tid));
      return;
    }
    const withFile = fileContext
      ? `${text}\n\n--- ATTACHED FILE (${fileContext.path}) ---\n${fileContext.content.slice(0, 12000)}`
      : text;
    const next = [...thread.msgs, { role: 'user', content: text }];
    patchThread(tid, { msgs: next });
    let acc = '';
    patchThread(tid, { msgs: [...next, { role: 'assistant', content: '' }] });
    const push = (t) => {
      acc += t;
      setThreads((cur) => cur.map((x) => {
        if (x.id !== tid) return x;
        const c = [...x.msgs];
        c[c.length - 1] = { role: 'assistant', content: acc };
        return { ...x, msgs: c };
      }));
    };
    try {
      const canUseTools = PROVIDERS.find((p) => p.id === thread.provider)?.supportsTools && mcpTools.length > 0 && window.codeit;
      const history = [{ role: 'system', content: sys }, ...next.map((m) => ({ role: m.role, content: m.content })).slice(-10)];
      history[history.length - 1] = { ...history[history.length - 1], content: withFile };
      if (canUseTools) {
        if (thread.provider === 'ollama' && !ollamaToolCapable(thread.model)) {
          push(`_Note: \`${thread.model}\` doesn't reliably emit tool calls — trying anyway. For reliable local tools switch to \`qwen3:8b\` or \`mistral:7b-instruct-v0.3-q4_0\`, or use Groq._\n\n`);
        }
        await chatWithTools({
          provider: thread.provider, model: thread.model, messages: history, mcpTools,
          onChunk: push,
          onToolEvent: (e) => setThreads((cur) => cur.map((x) => x.id === tid
            ? { ...x, toolLog: [...x.toolLog, `${e.status === 'calling' ? '⚙️' : '✅'} ${e.serverId}.${e.name}`] }
            : x)),
        });
      } else {
        if (mcpTools.length > 0 && !PROVIDERS.find((p) => p.id === thread.provider)?.supportsTools) {
          push(`_Note: ${thread.provider} is text-only here — MCP tools need Ollama/Groq/DeepSeek/OpenRouter. Skills + notes still apply._\n\n`);
        }
        await streamChat({ provider: thread.provider, model: thread.model, messages: history, onChunk: push });
      }
    } catch (err) {
      const hint = err.code === 'NO_KEY'
        ? String(err.message)
        : `Error: ${err.message} — Tip: run \`ollama serve\` and \`ollama pull ${thread.model}\`, or add a free cloud key.`;
      setThreads((cur) => cur.map((x) => {
        if (x.id !== tid) return x;
        const c = [...x.msgs];
        c[c.length - 1] = { role: 'assistant', content: acc ? acc + '\n\n' + hint : hint };
        return { ...x, msgs: c };
      }));
    }
    setBusyIds((b) => b.filter((id) => id !== tid));
  }

  async function send() {
    const text = input.trim();
    if (!text || busyIds.length) return;
    // shared project context: pinned files + skill match (computed once per send)
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
    setInput('');
    const targets = broadcast ? threads : [active];
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      await runThread(t, text, pinsText, sys);
    }
  }

  const busy = busyIds.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 8px', borderBottom: '1px solid #30363d', alignItems: 'center', flexWrap: 'wrap' }}>
        {threads.map((t, i) => (
          <span key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 2, border: t.id === activeId ? '1px solid #58a6ff' : '1px solid #30363d', borderRadius: 6, padding: '2px 4px', background: t.id === activeId ? '#1f6feb22' : 'transparent' }}>
            <button onClick={() => setActiveId(t.id)} title={`${t.provider}/${t.model}`} style={{ fontSize: 11, border: 0, background: 'transparent' }}>
              {i + 1}·{shortModel(t.model)}{busyIds.includes(t.id) ? '…' : ''}
            </button>
            {threads.length > 1 && <button onClick={() => closeThread(t.id)} title="Close thread" style={{ fontSize: 11, border: 0, background: 'transparent' }}>×</button>}
          </span>
        ))}
        {threads.length < MAX_THREADS && <button onClick={addThread} title="New chat thread (own model)" style={{ fontSize: 12 }}>+</button>}
        <span style={{ flex: 1 }} />
        <label title="Send prompt to all threads" style={{ fontSize: 11, opacity: 0.8 }}>
          <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} /> All
        </label>
        <button onClick={() => clearThread(activeId)} title="Clear this thread" style={{ fontSize: 12 }}>Clear</button>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '6px 8px', borderBottom: '1px solid #30363d', alignItems: 'center' }}>
        <select value={active.provider} onChange={(e) => {
          const p = PROVIDERS.find((x) => x.id === e.target.value);
          patchThread(activeId, { provider: p.id, model: p.models[0] });
        }} style={{ fontSize: 12 }}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select value={active.model} onChange={(e) => patchThread(activeId, { model: e.target.value })} style={{ fontSize: 12 }}>
          {PROVIDERS.find((p) => p.id === active.provider).models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{project ? `Project: ${project.name}` : 'No project'}</span>
        {mcpTools.length > 0 && <span style={{ fontSize: 11, opacity: 0.8 }}>🧰{mcpTools.length}</span>}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {active.msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%', background: m.role === 'user' ? '#1f6feb22' : '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', fontSize: 13 }}>
            <div style={{ fontSize: 11, opacity: 0.6 }}>{m.role}</div>
            {m.content || (busyIds.includes(activeId) && i === active.msgs.length - 1 ? '…' : '')}
          </div>
        ))}
        {active.toolLog.length > 0 && (
          <div style={{ fontSize: 11, opacity: 0.75, border: '1px dashed #30363d', borderRadius: 6, padding: '4px 8px' }}>
            {active.toolLog.map((t, i) => <div key={i}>{t}</div>)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: '1px solid #30363d' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={broadcast ? `Ask all ${threads.length} threads…` : `Ask ${active.model}…`} style={{ flex: 1 }} disabled={busy} />
        <button onClick={send} disabled={busy}>{busy ? '…' : 'Send'}</button>
      </div>
      <ToolApproval pending={pendings[activeId] || null} onResolve={(d) => resolveApproval(activeId, d)} />
    </div>
  );
}
