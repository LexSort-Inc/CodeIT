import { useEffect, useRef, useState } from 'react';
import { streamChat, chatWithTools, getEnabledMcpTools, PROVIDERS, ollamaToolCapable, canonProvider } from '../llm/router.js';
import { costUSD, fmtCost, fmtTokens } from '../llm/pricing.js';
import { matchSkills, buildSystemPrompt } from '../projects/context.js';
import ToolApproval from './ToolApproval.jsx';
import ModelPicker from './ModelPicker.jsx';
import { markDead, isDeadFailure } from '../llm/models.js';

const WELCOME = 'CodeIT ready. Ollama default `qwen2.5-coder:7b`. Attach file context with the +File button, pin files, or enable tools in Extensions.';
const MAX_THREADS = 4;
const PLANNER_SUFFIX = '\n\nYou are in PLAN MODE. Do not write code or call tools. Output: 1) files to touch, 2) numbered steps, 3) risks. End with "Awaiting approval — say Execute to proceed."';

function chatKey(projectId) {
  return `codeit.chat.${projectId || 'default'}`;
}

function newThread(provider, model, n) {
  const now = new Date().toISOString();
  return {
    id: `t${Date.now().toString(36)}${n}`,
    provider, model, title: 'New chat',
    createdAt: now, updatedAt: now, archived: false,
    msgs: [{ role: 'assistant', content: WELCOME }],
    toolLog: [], scope: [], editorPath: null, lastUsage: null, planned: false,
  };
}

function threadTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 44) : 'New chat';
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

function estimate(text, model) {
  const tokens = Math.ceil(String(text || '').length / 4);
  const c = costUSD(model, tokens, 800);
  return { tokens, cost: c };
}

export default function ChatPane({ provider, model, fileContext, setFileContext, project, projectNotes,
  onToolCount, planMode, setPlanMode, onUsageTick, onThreadSwitch, registerThreadEditor, openThreadId, onThreadOpened }) {
  const projectId = project?.id || 'default';
  const [threads, setThreads] = useState(() => [newThread(provider, model, 0)]);
  const [activeId, setActiveId] = useState(() => threads[0].id);
  const [selected, setSelected] = useState(() => new Set([threads[0].id]));
  const [compare, setCompare] = useState(false);
  const [input, setInput] = useState('');
  const [busyIds, setBusyIds] = useState([]);
  const [pendings, setPendings] = useState({}); // threadId -> approval state
  const [skills, setSkills] = useState([]);
  const [enabledSkillIds, setEnabledSkillIds] = useState(new Set());
  const [mcpTools, setMcpTools] = useState([]);
  const saveTimer = useRef(null);
  const approvalResolve = useRef({});
  const threadCount = useRef(0);
  const abortRef = useRef(null); // AbortController for the in-flight send (all targets)

  const openThreads = threads.filter((t) => !t.archived);
  const active = openThreads.find((t) => t.id === activeId) || openThreads[0] || threads[0];
  const [showHistory, setShowHistory] = useState(false);
  const [historyQ, setHistoryQ] = useState('');

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
        const fresh = (t) => ({ ...newThread(canonProvider(t.provider) || provider, t.model || model, 0), ...t, provider: canonProvider(t.provider) || provider });
        const open = saved.threads.filter((t) => !t.archived).slice(0, MAX_THREADS).map((t) => ({
          ...fresh(t),
          msgs: Array.isArray(t.msgs) && t.msgs.length ? t.msgs : [{ role: 'assistant', content: WELCOME }],
          toolLog: [], scope: Array.isArray(t.scope) ? t.scope : [],
        }));
        const archived = saved.threads.filter((t) => t.archived).slice(0, 50).map((t) => ({
          ...fresh(t),
          msgs: Array.isArray(t.msgs) ? t.msgs.slice(-100) : [{ role: 'assistant', content: WELCOME }],
          toolLog: [], scope: Array.isArray(t.scope) ? t.scope : [],
        }));
        list = [...open, ...archived];
        if (!open.length && archived.length) list[0].archived = false;
        if (!list.length) list = null;
      } else if (Array.isArray(saved) && saved.length) {
        list = [{ ...newThread(provider, model, 0), msgs: saved }];
      }
      if (list) {
        setThreads(list);
        setActiveId(list[0].id);
        setSelected(new Set(list.filter((t) => !t.archived).map((t) => t.id)));
      } else {
        const fresh = [newThread(provider, model, 0)];
        setThreads(fresh);
        setActiveId(fresh[0].id);
        setSelected(new Set([fresh[0].id]));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // load skills + enabled MCP tools for this project
  useEffect(() => {
    (async () => {
      if (!window.codeit) return;
      const [sk, catalog] = await Promise.all([window.codeit.skillsList(), window.codeit.toolsCatalog()]);
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
      const payload = { threads: threads.slice(0, MAX_THREADS + 50).map((t) => ({ id: t.id, provider: t.provider, model: t.model, title: t.title || 'New chat', titledVia: t.titledVia || null, createdAt: t.createdAt || null, updatedAt: t.updatedAt || null, archived: !!t.archived, msgs: t.msgs.slice(-100), scope: (t.scope || []).slice(0, 20), editorPath: t.editorPath || null })) };
      if (window.codeit?.projectsSaveChat) window.codeit.projectsSaveChat(projectId, payload);
      else { try { localStorage.setItem(chatKey(projectId), JSON.stringify(payload)); } catch {} }
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [threads, projectId]);

  // thread <-> editor binding: switching threads restores that thread's file
  useEffect(() => {
    onThreadSwitch?.({ id: activeId, editorPath: active?.editorPath || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // external jump (global chat search): open + activate thread, restoring if archived
  useEffect(() => {
    if (!openThreadId) return;
    const t = threads.find((x) => x.id === openThreadId);
    if (!t) return;
    if (t.archived) restoreThread(t.id);
    else setActiveId(t.id);
    onThreadOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadId, threads]);
  useEffect(() => {
    registerThreadEditor?.((path) => {
      setThreads((cur) => cur.map((t) => (t.id === activeId ? { ...t, editorPath: path } : t)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function addThread() {
    if (openThreads.length >= MAX_THREADS) return;
    threadCount.current += 1;
    const t = newThread(provider, model, threadCount.current);
    setThreads((cur) => [...cur, t]);
    setActiveId(t.id);
    setSelected((s) => new Set([...s, t.id]));
  }

  function archiveThread(id) {
    if (openThreads.length <= 1) return;
    const now = new Date().toISOString();
    setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, archived: true, updatedAt: now } : t)));
    setSelected((s) => { const c = new Set(s); c.delete(id); return c; });
    if (activeId === id) {
      const rest = openThreads.filter((t) => t.id !== id);
      if (rest.length) setActiveId(rest[rest.length - 1].id);
    }
  }

  function restoreThread(id) {
    // unarchive, then cap open tabs at MAX by re-archiving stalest (never the restored one)
    setThreads((cur) => {
      const next = cur.map((t) => (t.id === id ? { ...t, archived: false, updatedAt: new Date().toISOString() } : t));
      const open = next.filter((t) => !t.archived).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      if (open.length <= MAX_THREADS) return next;
      const drop = new Set(open.slice(MAX_THREADS).map((t) => t.id));
      drop.delete(id);
      // if still over (all others newer — impossible since restored is newest), drop oldest anyway
      if (open.length - drop.size > MAX_THREADS) drop.add(open[open.length - 1].id);
      return next.map((t) => (drop.has(t.id) ? { ...t, archived: true } : t));
    });
    setSelected((s) => new Set([...s, id]));
    setActiveId(id);
  }

  function deleteThread(id) {
    if (threads.filter((t) => !t.archived).length <= 1 && !threads.find((t) => t.id === id)?.archived) return;
    setThreads((cur) => cur.filter((t) => t.id !== id));
    setSelected((s) => { const c = new Set(s); c.delete(id); return c; });
    if (activeId === id) {
      const rest = openThreads.filter((t) => t.id !== id);
      if (rest.length) setActiveId(rest[rest.length - 1].id);
    }
  }

  function clearThread(id) {
    patchThread(id, { msgs: [{ role: 'assistant', content: WELCOME }], toolLog: [], planned: false, lastUsage: null });
  }

  function toggleSelect(id) {
    setSelected((s) => { const c = new Set(s); if (c.has(id)) c.delete(id); else c.add(id); return c; });
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

  async function buildCtx(text) {
    let pinsText = '';
    const scopePaths = [...new Set([...(active.scope || []), ...(project?.pinned || [])])].slice(0, 8);
    if (scopePaths.length && window.codeit?.fsRead) {
      const parts = [];
      for (const p of scopePaths) {
        try {
          const content = await window.codeit.fsRead(p);
          parts.push(`--- ${p} ---\n${content.slice(0, 6000)}`);
        } catch {}
      }
      pinsText = parts.join('\n\n');
    }
    const matched = matchSkills(skills, text, enabledSkillIds);
    return buildSystemPrompt({ notes: projectNotes, pinsText, skills: matched });
  }

  async function runThread(thread, text, sys, opts = {}) {
    const tid = thread.id;
    const planning = opts.planning ?? planMode;
    patchThread(tid, {
      updatedAt: new Date().toISOString(),
      ...(thread.title === 'New chat' ? { title: threadTitle(text), titledVia: `${thread.provider}/${thread.model}` } : null),
    });
    setBusyIds((b) => [...b, tid]);
    patchThread(tid, { toolLog: [], planned: false });
    // OpenCode engine: non-interactive agent run in the project dir (own tools + approvals)
    if (thread.provider === 'opencode') {
      const t0 = Date.now();
      const next = [...thread.msgs, { role: 'user', content: text }];
      patchThread(tid, { msgs: [...next, { role: 'assistant', content: '_OpenCode agent running in project dir…_' }] });
      if (!window.codeit?.opencodeRun) {
        patchThread(tid, { msgs: [...next, { role: 'assistant', content: 'Error: OpenCode engine needs Electron (`npm run dev`).' }] });
        setBusyIds((b) => b.filter((id) => id !== tid));
        return;
      }
      const recent = next.slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 2000)}`).join('\n\n');
      const prompt = `${sys}\n\n--- PROJECT NOTES ---\n${projectNotes || '(none)'}\n\n--- RECENT ---\n${recent}`;
      const r = await window.codeit.opencodeRun(project?.path || '', thread.model, prompt);
      patchThread(tid, {
        msgs: [...next, { role: 'assistant', content: r.ok ? (r.out || '(empty result)') : `OpenCode error: ${r.error || 'unknown'}`, via: `opencode/${thread.model}` }],
        toolLog: r.ok ? ['🤖 opencode agent run'] : [],
      });
      window.codeit?.usageRecord({ projectId, provider: 'opencode', model: thread.model, ms: Date.now() - t0, prompt: 0, completion: 0 });
      onUsageTick?.();
      setBusyIds((b) => b.filter((id) => id !== tid));
      return;
    }
    const t0 = Date.now();
    const use = { prompt: 0, completion: 0 };
    const onUsage = (u) => { use.prompt += u.prompt || 0; use.completion += u.completion || 0; };
    const withFile = fileContext
      ? `${text}\n\n--- ATTACHED FILE (${fileContext.path}) ---\n${fileContext.content.slice(0, 12000)}`
      : text;
    const next = [...thread.msgs, { role: 'user', content: text }];
    const via = `${thread.provider}/${thread.model}`;
    patchThread(tid, { msgs: next });
    let acc = '';
    patchThread(tid, { msgs: [...next, { role: 'assistant', content: '', via }] });
    const push = (t) => {
      acc += t;
      setThreads((cur) => cur.map((x) => {
        if (x.id !== tid) return x;
        const c = [...x.msgs];
        c[c.length - 1] = { role: 'assistant', content: acc, via };
        return { ...x, msgs: c };
      }));
    };
    try {
      const sysMsg = planning ? sys + PLANNER_SUFFIX : sys;
      const canUseTools = !planning && PROVIDERS.find((p) => p.id === thread.provider)?.supportsTools && mcpTools.length > 0 && window.codeit;
      const history = [{ role: 'system', content: sysMsg }, ...next.map((m) => ({ role: m.role, content: m.content })).slice(-10)];
      history[history.length - 1] = { ...history[history.length - 1], content: withFile };
      if (canUseTools) {
        if (thread.provider === 'ollama' && !ollamaToolCapable(thread.model)) {
          push(`_Note: \`${thread.model}\` doesn't reliably emit tool calls — trying anyway. For reliable local tools switch to \`qwen3:8b\` or \`mistral:7b-instruct-v0.3-q4_0\`, or use Groq._\n\n`);
        }
        await chatWithTools({
          provider: thread.provider, model: thread.model, messages: history, mcpTools,
          onChunk: push, onUsage, signal: opts.signal,
          onToolEvent: (e) => setThreads((cur) => cur.map((x) => x.id === tid
            ? { ...x, toolLog: [...x.toolLog, `${e.status === 'calling' ? '⚙️' : '✅'} ${e.serverId}.${e.name}`] }
            : x)),
        });
      } else {
        if (!planning && mcpTools.length > 0 && !PROVIDERS.find((p) => p.id === thread.provider)?.supportsTools) {
          push(`_Note: ${thread.provider} is text-only here — MCP tools need Ollama/Groq/DeepSeek/OpenRouter. Skills + notes still apply._\n\n`);
        }
        await streamChat({ provider: thread.provider, model: thread.model, messages: history, onChunk: push, onUsage, signal: opts.signal });
      }
      if (planning) patchThread(tid, { planned: true });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        setThreads((cur) => cur.map((x) => {
          if (x.id !== tid) return x;
          const c = [...x.msgs];
          c[c.length - 1] = { role: 'assistant', content: acc ? acc + '\n\n_Stopped._' : '_Stopped._', via };
          return { ...x, msgs: c };
        }));
        window.codeit?.usageRecord({ projectId, provider: thread.provider, model: thread.model, ms: Date.now() - t0, prompt: use.prompt, completion: use.completion });
        onUsageTick?.();
        setBusyIds((b) => b.filter((id) => id !== tid));
        return;
      }
      const msg = String(err.message || '');
      if (isDeadFailure(msg)) markDead(canonProvider(thread.provider), thread.model, msg);
      const hint = err.code === 'NO_KEY' ? String(err.message)
        : /model_not_found|does not exist|no longer available|deprecated|retired/i.test(msg) ? `${msg} — Tip: that model ID is retired or not enabled on your key. Open the model menu, hit ↻, and pick a current one.`
        : /credit|billing|balance/i.test(msg) ? `${msg} — Tip: top up that provider's account, or switch the thread to Ollama/Groq free tier.`
        : thread.provider === 'ollama' ? `${msg} — Tip: run \`ollama serve\` and \`ollama pull ${thread.model}\`.`
        : `${msg} — Tip: check the key in Keys, or switch the thread to Ollama (local, no key).`;
      setThreads((cur) => cur.map((x) => {
        if (x.id !== tid) return x;
        const c = [...x.msgs];
        c[c.length - 1] = { role: 'assistant', content: acc ? acc + '\n\n' + hint : hint };
        return { ...x, msgs: c };
      }));
    }
    const cost = costUSD(thread.model, use.prompt, use.completion);
    patchThread(tid, { lastUsage: { ...use, cost } });
    window.codeit?.usageRecord({ projectId, provider: thread.provider, model: thread.model, ms: Date.now() - t0, prompt: use.prompt, completion: use.completion });
    onUsageTick?.();
    setBusyIds((b) => b.filter((id) => id !== tid));
  }

  async function runToolDirect(thread, spec) {
    // /tool short.name {"json"} — explicit single tool call, no LLM round-trip
    const tid = thread.id;
    const m = spec.match(/^([\w-]+)\.([\w-]+)\s*(\{[\s\S]*\})?\s*$/);
    if (!m) {
      patchThread(tid, { msgs: [...thread.msgs, { role: 'user', content: `/tool ${spec}` }, { role: 'assistant', content: 'Usage: `/tool server.tool {"arg":…}` — e.g. `/tool memory.read_graph {}`. Servers: ' + mcpTools.map((t) => t.serverId.replace(/^mcp:/, '')).filter((v, i, a) => a.indexOf(v) === i).join(', ') }] });
      return;
    }
    const [, short, name, json] = m;
    let args = {};
    try { args = json ? JSON.parse(json) : {}; } catch { args = {}; }
    setBusyIds((b) => [...b, tid]);
    const next = [...thread.msgs, { role: 'user', content: `/tool ${spec}` }, { role: 'assistant', content: `_Running ${short}.${name}…_` }];
    patchThread(tid, { msgs: next });
    const out = await executeTool(tid, { serverId: `mcp:${short}`, name, args });
    patchThread(tid, {
      msgs: [...next.slice(0, -1), { role: 'assistant', content: `**${short}.${name}** result:\n\n\`\`\`\n${String(out).slice(0, 6000)}\n\`\`\`` }],
      toolLog: [...thread.toolLog, `⚙️ mcp:${short}.${name}`],
    });
    setBusyIds((b) => b.filter((id) => id !== tid));
  }

  async function executePlan(thread) {
    const planMsg = [...thread.msgs].reverse().find((m) => m.role === 'assistant');
    if (!planMsg) return;
    setPlanMode(false);
    const sys = await buildCtx(`execute approved plan for ${project?.name || 'project'}`);
    runThread(thread, `Approved plan — execute it now, step by step:\n\n${planMsg.content.slice(0, 6000)}`, sys, { planning: false });
  }

  async function retryThread(thread) {
    const idx = [...thread.msgs].map((m) => m.role).lastIndexOf('user');
    if (idx < 0 || busyIds.length) return;
    const text = thread.msgs[idx].content;
    patchThread(thread.id, { msgs: thread.msgs.slice(0, idx), planned: false });
    const sys = await buildCtx(text);
    runThread({ ...thread, msgs: thread.msgs.slice(0, idx) }, text, sys);
  }

  async function send() {
    const text = input.trim();
    if (!text || busyIds.length) return;
    if (text === '/plan') { setPlanMode(!planMode); setInput(''); return; }
    const targets = selected.size ? openThreads.filter((t) => selected.has(t.id)) : [active];
    if (!targets.length) return;
    if (text.startsWith('/tool ')) {
      setInput('');
      await runToolDirect(active, text.slice(6).trim());
      return;
    }
    const sys = await buildCtx(text);
    // consume attached file into each target thread's scope (their own editor context)
    if (fileContext?.path) {
      for (const t of targets) {
        patchThread(t.id, { scope: [...new Set([...(t.scope || []), fileContext.path])].slice(0, 20) });
      }
      setFileContext?.(null);
    }
    setInput('');
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      for (const t of targets) {
        // eslint-disable-next-line no-await-in-loop
        await runThread(t, text, sys, { signal: ctrl.signal });
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  function stopAll() {
    abortRef.current?.abort();
    window.codeit?.opencodeCancel(project?.path || '');
    // runThread completions clear their own busy flags; force-clear in case one is stuck
    setTimeout(() => setBusyIds([]), 500);
  }

  function threadCost(t) {
    if (!t.lastUsage) return null;
    if (t.provider === 'ollama' || t.provider === 'opencode') return 'FREE';
    if (t.lastUsage.cost == null) return null;
    return fmtCost(t.lastUsage.cost);
  }

  const busy = busyIds.length > 0;
  const est = input.trim() ? estimate(input, active.model) : null;
  const lastAssistant = [...active.msgs].reverse().find((m) => m.role === 'assistant');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <div className="threadbar" role="tablist" aria-label="Threads">
        {openThreads.map((t, i) => (
          <span key={t.id} className={`pill${t.id === activeId ? ' active' : ''}`}>
            {openThreads.length > 1 && (
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)}
                title="Include in broadcast" aria-label={`Include thread ${i + 1} in broadcast`} />
            )}
            <button role="tab" aria-selected={t.id === activeId} onClick={() => setActiveId(t.id)}
              title={`${t.title || 'New chat'} · ${t.provider}/${t.model}${t.lastUsage ? ` · last: ${fmtTokens(t.lastUsage.prompt + t.lastUsage.completion)}` : ''}${(t.scope || []).length ? ` · 📎${t.scope.length}` : ''}`}>
              {i + 1}·{shortModel(t.model)}{busyIds.includes(t.id) ? '…' : ''}{(t.scope || []).length ? ` 📎${t.scope.length}` : ''}
            </button>
            {openThreads.length > 1 && <button onClick={() => archiveThread(t.id)} title="Archive thread (kept in History)" aria-label={`Archive thread ${i + 1}`}>×</button>}
          </span>
        ))}
        {openThreads.length < MAX_THREADS && <button className="btn btn-sm btn-ghost" onClick={addThread} title="New chat thread (own model)">+</button>}
        {openThreads.length > 1 && (
          <button className="btn btn-sm btn-ghost" onClick={() => setCompare(!compare)} title="Compare threads side by side" aria-pressed={compare}>
            {compare ? 'Single' : 'Compare'}
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => setShowHistory(!showHistory)} title="Chat history for this project" aria-pressed={showHistory}>History</button>
        <button className="btn btn-sm btn-ghost" onClick={() => clearThread(activeId)} title="Clear this thread">Clear</button>
      </div>
      {showHistory && (
        <div style={{ borderBottom: '1px solid #30363d', padding: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '45%', overflowY: 'auto' }}>
          <input value={historyQ} onChange={(e) => setHistoryQ(e.target.value)} placeholder="Search chats…" style={{ fontSize: 12 }} />
          {threads
            .filter((t) => !historyQ.trim() || `${t.title || ''} ${t.model} ${t.provider}`.toLowerCase().includes(historyQ.trim().toLowerCase()))
            .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
            .map((t) => (
              <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: t.archived ? 0.6 : 1 }}
                  title={`${t.titledVia || `${t.provider}/${t.model}`} · ${(t.msgs || []).length} msgs`}>
                  {t.archived ? '📦 ' : '💬 '}{t.title || 'New chat'} <span style={{ opacity: 0.6 }}>· {t.titledVia || `${t.provider}/${shortModel(t.model)}`}</span>
                </span>
                {!t.archived
                  ? <button className="btn btn-sm btn-ghost" onClick={() => { setActiveId(t.id); setShowHistory(false); }}>Open</button>
                  : <button className="btn btn-sm btn-ghost" onClick={() => restoreThread(t.id)}>Restore</button>}
                <button className="btn btn-sm btn-ghost" onClick={() => deleteThread(t.id)} title="Delete forever">✕</button>
              </div>
            ))}
        </div>
      )}
      <div className="thread-meta">
        <ModelPicker provider={active.provider} model={active.model}
          onPick={(provider, model) => patchThread(activeId, { provider, model })} />
        <button className={`btn btn-sm${planMode ? ' btn-primary' : ' btn-ghost'}`} onClick={() => setPlanMode(!planMode)}
          title="Plan mode: model plans, you approve, then it executes" aria-pressed={planMode}>Plan</button>
        <span>{project ? `Project: ${project.name}` : 'No project'}</span>
        {mcpTools.length > 0 && <span>🧰{mcpTools.length}</span>}
        {threadCost(active) && <span title="Last call cost">· {threadCost(active)}</span>}
      </div>
      <div className="messages" role="log" aria-live="polite" aria-label="Chat messages">
        {compare && openThreads.length > 1 ? (
          openThreads.filter((t) => selected.has(t.id)).map((t) => {
            const last = [...t.msgs].reverse().find((m) => m.role === 'assistant');
            const who = last?.via || `${t.provider}/${t.model}`;
            return (
              <div key={t.id} className="bubble assistant" style={{ alignSelf: 'stretch', maxWidth: '100%' }}>
                <div className="role">{who}{threadCost(t) ? ` · ${threadCost(t)}` : ''}</div>
                {last ? last.content.slice(0, 2000) : '(no response yet)'}
              </div>
            );
          })
        ) : (
          active.msgs.map((m, i) => (
            <div key={i} className={`bubble ${m.role === 'user' ? 'user' : 'assistant'}`}>
              <div className="role">{m.role === 'assistant' ? (m.via || 'assistant') : m.role}</div>
              {m.content || (busyIds.includes(activeId) && i === active.msgs.length - 1 ? '…' : '')}
            </div>
          ))
        )}
        {!compare && active.toolLog.length > 0 && (
          <div className="toollog">
            {active.toolLog.map((t, i) => <div key={i}>{t}</div>)}
          </div>
        )}
        {!compare && !busy && lastAssistant && lastAssistant.content && lastAssistant.content !== WELCOME && (
          <div className="row">
            <button className="btn btn-sm btn-ghost" onClick={() => retryThread(active)} title="Re-run last prompt">↻ Retry</button>
            {active.planned && <button className="btn btn-sm btn-primary" onClick={() => executePlan(active)} title="Approve plan and execute">▶ Execute plan</button>}
          </div>
        )}
      </div>
      {planMode && (
        <div style={{ padding: '6px 10px', borderTop: '1px solid #30363d', fontSize: 12, background: '#1f6feb22' }}>
          📋 <strong>PLAN MODE</strong> — the model will plan only, no tools, no edits. Review the plan, then press <strong>▶ Execute plan</strong> (or toggle Plan off to chat normally).
        </div>
      )}
      <div className="composer">
        <label className="sr-only" htmlFor="codeit-chat">Chat message</label>
        <textarea id="codeit-chat" rows={1} value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={selected.size > 1 ? `Ask ${selected.size} threads… (/tool, /plan)` : `Ask ${active.model}… (/tool, /plan)`}
          title="Enter sends · Shift+Enter newline · /tool runs a tool directly · /plan toggles plan mode"
          disabled={busy} />
        {est && (
          <span className="estimate" title="Pre-send estimate">
            ≈{fmtTokens(est.tokens)}{est.cost == null ? '' : active.provider === 'ollama' || active.provider === 'opencode' ? ' · FREE' : ` · ${fmtCost(est.cost)}`}
          </span>
        )}
        {busy
          ? <button className="btn btn-danger" onClick={stopAll} title="Stop all running threads">⏹ Stop</button>
          : <button className="btn btn-primary" onClick={send}>{planMode ? 'Plan' : 'Send'}</button>}
      </div>
      <ToolApproval pending={pendings[activeId] || null} onResolve={(d) => resolveApproval(activeId, d)} />
    </div>
  );
}
