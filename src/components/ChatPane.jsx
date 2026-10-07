import { useEffect, useRef, useState, useCallback } from 'react';
import { streamChat, chatWithTools, getEnabledMcpTools, PROVIDERS, ollamaToolCapable, canonProvider, getKeys } from '../llm/router.js';
import { costUSD, fmtCost, fmtTokens } from '../llm/pricing.js';
import { matchSkills, buildSystemPrompt } from '../projects/context.js';
import ToolApproval from './ToolApproval.jsx';
import ModelPicker from './ModelPicker.jsx';
import { markDead, isDeadFailure, isTempDeadFailure, isDead, isErrorBubble, TEMP_DEAD_TTL_MS, allModels, splitReady } from '../llm/models.js';

const WELCOME = 'CodeIT ready. Pick a model above — free-tier Groq/Gemini only need a key. Add more columns for multi-model compare.';
const MAX_COLS = 4;
const PLANNER_SUFFIX = '\n\nYou are in PLAN MODE. Do not write code or call tools. Output: 1) files to touch, 2) numbered steps, 3) risks. End with "Awaiting approval — say Execute to proceed."';

function chatKey(projectId) { return `codeit.chat.${projectId || 'default'}`; }

function newThread(provider, model, n) {
  const now = new Date().toISOString();
  return {
    id: `t${Date.now().toString(36)}${n}`,
    provider, model, title: 'New chat',
    createdAt: now, updatedAt: now, archived: false,
    msgs: [{ role: 'assistant', content: WELCOME }],
    toolLog: [], scope: [], editorPath: null, lastUsage: null, planned: false,
    errStreak: 0, errModel: null,
  };
}

function threadTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 44) : 'New chat';
}

function shortModel(m) {
  const s = String(m || '');
  if (s.includes('/')) { const p = s.split('/'); return p[p.length - 1].replace(':free', '').slice(0, 20); }
  return s.length > 20 ? s.slice(0, 19) + '…' : s;
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

function renderBubbleContent(content) {
  if (!content) return null;
  // Check if content contains markdown images: ![alt](url)
  const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = imgRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }
    const alt = match[1] || 'generated image';
    const src = match[2];
    parts.push(
      <div key={match.index} style={{ margin: '8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <img
          src={src}
          alt={alt}
          loading="lazy"
          style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <a
            href={src}
            download={`codeit-${Date.now()}.jpg`}
            target="_blank"
            rel="noreferrer"
            className="col-btn col-btn-primary"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            💾 Save Image
          </a>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="col-btn"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            ↗ Open Full Size
          </a>
        </div>
      </div>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  return parts.length ? parts : content;
}

// ─── Slash commands catalogue ─────────────────────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/image',  label: '🖼️  Generate image',  desc: 'Create a free AI image with Flux — e.g. /image a neon cat' },
  { cmd: '/plan',   label: '📋 Plan mode',         desc: 'Model plans steps first, you approve before it executes' },
  { cmd: '/clear',  label: '🗑️  Clear chat',        desc: 'Wipe all messages in this column' },
  { cmd: '/retry',  label: '↻  Retry last',        desc: 'Re-run your previous prompt' },
  { cmd: '/tool',   label: '🧰 List MCP tools',    desc: 'Show which MCP tools are enabled in this session' },
];

function SlashMenu({ filter, selected, onSelect, onClose }) {
  const items = SLASH_COMMANDS.filter((c) => c.cmd.startsWith('/' + filter));
  if (!items.length) return null;
  return (
    <div className="slash-menu" role="listbox" aria-label="Slash commands">
      {items.map((item, i) => (
        <div
          key={item.cmd}
          className={`slash-menu-item${i === selected ? ' slash-menu-item--active' : ''}`}
          role="option"
          aria-selected={i === selected}
          onMouseDown={(e) => { e.preventDefault(); onSelect(item.cmd); }}
        >
          <span className="slash-cmd-label">{item.label}</span>
          <span className="slash-cmd-desc">{item.desc}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Single Model Column ──────────────────────────────────────────────────────
function ModelColumn({
  thread, busy, planMode, onPick, onSend, onStop, onRetry, onExecutePlan,
  onClear, onClone, onClose, canClose, colCount, fileContext,
}) {
  const [input, setInput] = useState('');
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.msgs.length, busy]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  }, [input]);

  function go() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setSlashOpen(false);
    onSend(thread.id, text);
  }

  const lastAssistant = [...thread.msgs].reverse().find((m) => m.role === 'assistant');
  const est = input.trim() ? estimate(input, thread.model) : null;
  const providerInfo = PROVIDERS.find((p) => p.id === thread.provider);

  function tierBadge() {
    if (thread.provider === 'ollama') return <span className="col-tier local">LOCAL</span>;
    if (thread.provider === 'groq' || thread.provider === 'gemini') return <span className="col-tier free">FREE</span>;
    if (thread.provider === 'openrouter' && String(thread.model).endsWith(':free')) return <span className="col-tier free">FREE</span>;
    return null;
  }

  return (
    <div className={`model-col${busy ? ' model-col--busy' : ''}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Column header */}
      <div className="col-header">
        <div className="col-header-top">
          <ModelPicker provider={thread.provider} model={thread.model} onPick={(p, m) => onPick(thread.id, p, m)} />
          {tierBadge()}
          {thread.lastUsage && (
            <span className="col-cost" title="Last call cost">
              {thread.provider === 'ollama' || thread.provider === 'opencode' ? '⚡ free' : fmtCost(thread.lastUsage.cost)}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {thread.toolLog.length > 0 && (
            <span className="col-tools" title={thread.toolLog.join('\n')}>🧰{thread.toolLog.length}</span>
          )}
          {canClose && (
            <button className="col-btn col-close-btn" onClick={() => onClose(thread.id)} title="Remove this column" aria-label="Remove column">✕</button>
          )}
        </div>
        <div className="col-header-sub">
          <span className="col-thread-title">{thread.title !== 'New chat' ? thread.title : ''}</span>
          <button className="col-btn col-btn-ghost" onClick={() => onClear(thread.id)} disabled={busy} title="Clear conversation">Clear</button>
          {colCount < MAX_COLS && (
            <button className="col-btn col-btn-ghost" onClick={() => onClone(thread.id)} title="Clone this column with same model">+ Clone</button>
          )}
          {canClose && (
            <button className="col-btn col-btn-ghost col-btn-danger" onClick={() => onClose(thread.id)} title="Close this column">✕ Close</button>
          )}
          {planMode && <span className="col-plan-badge">📋 PLAN</span>}
          {busy && <span className="col-busy-dot" aria-label="Generating">●</span>}
        </div>
      </div>

      {/* Messages */}
      <div className="col-messages" role="log" aria-live="polite">
        {thread.msgs.map((m, i) => (
          <div key={i} className={`col-bubble${m.role === 'user' ? ' col-bubble--user' : ' col-bubble--ai'}`}>
            <div className="col-bubble-role">
              {m.role === 'user' ? 'you' : (m.via ? shortModel(m.via.split('/').slice(1).join('/') || m.via) : 'ai')}
            </div>
            <div className="col-bubble-content">
              {renderBubbleContent(m.content || (busy && i === thread.msgs.length - 1 ? '…' : ''))}
            </div>
          </div>
        ))}
        {thread.toolLog.length > 0 && (
          <div className="col-toollog">
            {thread.toolLog.map((t, i) => <div key={i}>{t}</div>)}
          </div>
        )}
        {!busy && lastAssistant?.content && lastAssistant.content !== WELCOME && (
          <div className="col-actions">
            <button className="col-btn col-btn-ghost" onClick={() => onRetry(thread.id)} title="Re-run last prompt">↻ Retry</button>
            {thread.planned && (
              <button className="col-btn col-btn-primary" onClick={() => onExecutePlan(thread.id)} title="Approve plan and execute">▶ Execute plan</button>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="col-composer">
        {fileContext && (
          <div className="col-file-ctx">📎 {fileContext.path?.split(/[/\\]/).pop() || 'file'}</div>
        )}
        <div className="col-composer-wrap">
          {slashOpen && (
            <SlashMenu
              filter={slashFilter}
              selected={slashIdx}
              onSelect={(cmd) => {
                setInput(cmd + ' ');
                setSlashOpen(false);
                setSlashIdx(0);
                textareaRef.current?.focus();
              }}
              onClose={() => setSlashOpen(false)}
            />
          )}
          <div className="col-composer-row">
            <textarea
              ref={textareaRef}
              className="col-input"
              value={input}
              rows={1}
              onChange={(e) => {
                const val = e.target.value;
                setInput(val);
                if (val.startsWith('/') && !val.includes(' ')) {
                  setSlashFilter(val.slice(1));
                  setSlashOpen(true);
                  setSlashIdx(0);
                } else {
                  setSlashOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (slashOpen) {
                  const visible = SLASH_COMMANDS.filter((c) => c.cmd.startsWith('/' + slashFilter));
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => (i + 1) % Math.max(1, visible.length)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((i) => (i - 1 + visible.length) % Math.max(1, visible.length)); return; }
                  if (e.key === 'Tab' || (e.key === 'Enter' && visible.length > 0)) {
                    e.preventDefault();
                    const item = visible[slashIdx] || visible[0];
                    if (item) { setInput(item.cmd + ' '); setSlashOpen(false); setSlashIdx(0); }
                    return;
                  }
                  if (e.key === 'Escape') { e.preventDefault(); setSlashOpen(false); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
              }}
              onBlur={() => { setTimeout(() => setSlashOpen(false), 150); }}
              placeholder={busy ? 'Generating…' : `Ask ${shortModel(thread.model)}… (/ for commands)`}
              disabled={busy}
              aria-label={`Ask ${thread.model}`}
              aria-autocomplete="list"
              aria-expanded={slashOpen}
            />
            {busy
              ? <button className="col-send col-send-stop" onClick={() => onStop(thread.id)} title="Stop">⏹</button>
              : <button className="col-send col-send-go" onClick={go} disabled={!input.trim()} title="Send (Enter)">↑</button>
            }
          </div>
        </div>
        {est && (
          <div className="col-estimate">
            ≈{fmtTokens(est.tokens)}{est.cost == null ? '' : thread.provider === 'ollama' ? ' · free' : ` · ${fmtCost(est.cost)}`}
          </div>
        )}
      </div>

      {/* Plan mode banner */}
      {planMode && (
        <div className="col-plan-banner">
          📋 Plan mode — model will plan only. Review then press ▶ Execute.
        </div>
      )}
    </div>
  );
}

// ─── Main ChatPane ────────────────────────────────────────────────────────────
export default function ChatPane({
  provider, model, fileContext, setFileContext, project, projectNotes,
  onToolCount, planMode, setPlanMode, onUsageTick, onThreadSwitch,
  registerThreadEditor, openThreadId, onThreadOpened,
}) {
  const projectId = project?.id || 'default';
  const [threads, setThreads] = useState(() => [newThread(provider, model, 0)]);
  // colOrder: array of thread IDs shown as columns (1-4)
  const [colOrder, setColOrder] = useState(() => [threads[0].id]);
  const [busyIds, setBusyIds] = useState([]);
  const [pendings, setPendings] = useState({});
  const [skills, setSkills] = useState([]);
  const [enabledSkillIds, setEnabledSkillIds] = useState(new Set());
  const [mcpTools, setMcpTools] = useState([]);
  // Broadcast input (shared across columns)
  const [broadcastInput, setBroadcastInput] = useState('');
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [bcSlashOpen, setBcSlashOpen] = useState(false);
  const [bcSlashFilter, setBcSlashFilter] = useState('');
  const [bcSlashIdx, setBcSlashIdx] = useState(0);
  const [grid2x2, setGrid2x2] = useState(true);
  const saveTimer = useRef(null);
  const approvalResolve = useRef({});
  const threadCount = useRef(0);
  const abortsRef = useRef(new Map());

  function endRun(tid) {
    abortsRef.current.delete(tid);
    setBusyIds((b) => b.filter((id) => id !== tid));
  }

  function patchThread(id, patch) {
    const p = patch.provider ? { provider: canonProvider(patch.provider) || patch.provider } : null;
    setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch, ...p } : t)));
  }

  // Load saved threads
  useEffect(() => {
    (async () => {
      let saved = null;
      if (window.codeit?.projectsGetChat) saved = await window.codeit.projectsGetChat(projectId);
      else { try { saved = JSON.parse(localStorage.getItem(chatKey(projectId))); } catch { saved = null; } }
      let list = null;
      if (saved && Array.isArray(saved.threads) && saved.threads.length) {
        const fresh = (t) => {
          const base = { ...newThread(canonProvider(t.provider) || provider, t.model || model, 0), ...t, provider: canonProvider(t.provider) || provider };
          const lastAssistant = [...(t.msgs || [])].reverse().find((m) => m.role === 'assistant' && m.content && m.content !== WELCOME);
          if (isDead(base.provider, base.model) || (lastAssistant && isErrorBubble(lastAssistant.content))) {
            base.provider = provider; base.model = model; base.errStreak = 0; base.errModel = null;
          }
          return base;
        };
        const open = saved.threads.filter((t) => !t.archived).slice(0, MAX_COLS * 2).map((t) => ({
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
        const openThreads = list.filter((t) => !t.archived);
        const cols = saved?.colOrder?.filter((id) => openThreads.find((t) => t.id === id)) || [openThreads[0]?.id].filter(Boolean);
        setColOrder(cols.length ? cols : [openThreads[0]?.id || list[0].id]);
      } else {
        const fresh = [newThread(provider, model, 0)];
        setThreads(fresh);
        setColOrder([fresh[0].id]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Load skills + MCP tools
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

  // Persist threads (debounced)
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = {
        threads: threads.slice(0, MAX_COLS + 50).map((t) => ({
          id: t.id, provider: t.provider, model: t.model, title: t.title || 'New chat',
          titledVia: t.titledVia || null, createdAt: t.createdAt || null, updatedAt: t.updatedAt || null,
          archived: !!t.archived, msgs: t.msgs.slice(-100), scope: (t.scope || []).slice(0, 20),
          editorPath: t.editorPath || null, errStreak: t.errStreak || 0, errModel: t.errModel || null,
        })),
        colOrder,
      };
      if (window.codeit?.projectsSaveChat) window.codeit.projectsSaveChat(projectId, payload);
      else { try { localStorage.setItem(chatKey(projectId), JSON.stringify(payload)); } catch {} }
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [threads, colOrder, projectId]);

  // Thread <-> editor binding
  useEffect(() => {
    const activeColId = colOrder[0];
    if (activeColId) onThreadSwitch?.({ id: activeColId, editorPath: threads.find((t) => t.id === activeColId)?.editorPath || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colOrder[0]]);

  useEffect(() => {
    registerThreadEditor?.((path) => {
      const activeId = colOrder[0];
      if (activeId) setThreads((cur) => cur.map((t) => (t.id === activeId ? { ...t, editorPath: path } : t)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colOrder[0]]);

  // External jump
  useEffect(() => {
    if (!openThreadId) return;
    const t = threads.find((x) => x.id === openThreadId);
    if (!t) return;
    if (t.archived) {
      setThreads((cur) => cur.map((x) => (x.id === openThreadId ? { ...x, archived: false } : x)));
    }
    if (!colOrder.includes(openThreadId)) setColOrder((c) => [openThreadId, ...c].slice(0, MAX_COLS));
    onThreadOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadId, threads]);

  // ── Column management ──────────────────────────────────────────────────────
  function addColumn() {
    if (colOrder.length >= MAX_COLS) return;
    threadCount.current += 1;
    // Try to pick a different model than what's already visible
    const usedModels = new Set(colOrder.map((id) => {
      const t = threads.find((x) => x.id === id);
      return t ? `${t.provider}/${t.model}` : null;
    }).filter(Boolean));
    const defaultP = provider;
    const defaultM = model;
    const t = newThread(defaultP, defaultM, threadCount.current);
    setThreads((cur) => [...cur, t]);
    setColOrder((c) => [...c, t.id]);
  }

  async function addSmartColumn() {
    if (colOrder.length >= MAX_COLS) return;
    let alt = null;
    try {
      const keys = await getKeys();
      const verified = new Set();
      try {
        const u = await window.codeit?.usageGet?.();
        for (const e of u?.events || []) if (e.ok) verified.add(`${e.provider}/${e.model}`);
      } catch {}
      const g = splitReady(allModels(), keys, verified);
      const pool = [...g.working, ...g.ready, ...g.needsKey.filter((m) => m.tier === 'free')];
      const usedKeys = new Set(colOrder.map((id) => {
        const t = threads.find((x) => x.id === id);
        return t ? `${t.provider}/${t.model}` : null;
      }).filter(Boolean));
      alt = pool.find((m) => !usedKeys.has(`${m.provider}/${m.model}`)) || null;
    } catch {}
    threadCount.current += 1;
    const t = newThread(alt?.provider || provider, alt?.model || model, threadCount.current);
    setThreads((cur) => [...cur, t]);
    setColOrder((c) => [...c, t.id]);
  }

  function cloneColumn(srcId) {
    if (colOrder.length >= MAX_COLS) return;
    const src = threads.find((t) => t.id === srcId);
    if (!src) return;
    threadCount.current += 1;
    const t = { ...newThread(src.provider, src.model, threadCount.current) };
    setThreads((cur) => [...cur, t]);
    setColOrder((c) => [...c, t.id]);
  }

  function removeColumn(id) {
    if (colOrder.length <= 1) return;
    // Archive instead of deleting (keeps history)
    setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, archived: true, updatedAt: new Date().toISOString() } : t)));
    setColOrder((c) => c.filter((x) => x !== id));
    // Abort any running stream
    abortsRef.current.get(id)?.abort();
  }

  function pickModel(threadId, p, m) {
    patchThread(threadId, { provider: p, model: m });
  }

  function clearThread(id) {
    patchThread(id, { msgs: [{ role: 'assistant', content: WELCOME }], toolLog: [], planned: false, lastUsage: null });
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

  async function buildCtx(text, thread) {
    const identity = thread ? `${thread.model} (via ${thread.provider} inside CodeIT)` : null;
    let pinsText = '';
    const scopePaths = [...new Set([...(thread?.scope || []), ...(project?.pinned || [])])].slice(0, 8);
    if (scopePaths.length && window.codeit?.fsRead) {
      const parts = [];
      for (const p of scopePaths) {
        try { const content = await window.codeit.fsRead(p); parts.push(`--- ${p} ---\n${content.slice(0, 6000)}`); } catch {}
      }
      pinsText = parts.join('\n\n');
    }
    const matched = matchSkills(skills, text, enabledSkillIds);
    return buildSystemPrompt({ notes: projectNotes, pinsText, skills: matched, identity });
  }

  async function runThread(thread, text, sys, opts = {}) {
    const tid = thread.id;
    const planning = opts.planning ?? planMode;
    abortsRef.current.get(tid)?.abort();
    const ctrl = new AbortController();
    abortsRef.current.set(tid, ctrl);
    patchThread(tid, {
      updatedAt: new Date().toISOString(),
      ...(thread.title === 'New chat' ? { title: threadTitle(text), titledVia: `${thread.provider}/${thread.model}` } : null),
    });
    setBusyIds((b) => [...b, tid]);
    patchThread(tid, { toolLog: [], planned: false });

    // OpenCode engine
    if (canonProvider(thread.provider) === 'opencode') {
      const t0 = Date.now();
      const next = [...thread.msgs, { role: 'user', content: text }];
      patchThread(tid, { msgs: [...next, { role: 'assistant', content: '_OpenCode agent running…_' }] });
      if (!window.codeit?.opencodeRun) {
        patchThread(tid, { msgs: [...next, { role: 'assistant', content: 'Error: OpenCode engine needs Electron (`npm run dev`).' }] });
        endRun(tid); return;
      }
      const recent = next.slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 2000)}`).join('\n\n');
      const prompt = `${sys}\n\n--- PROJECT NOTES ---\n${projectNotes || '(none)'}\n\n--- RECENT ---\n${recent}`;
      const r = await window.codeit.opencodeRun(project?.path || '', thread.model, prompt);
      if (abortsRef.current.get(tid) !== ctrl) return;
      patchThread(tid, {
        msgs: [...next, { role: 'assistant', content: r.ok ? (r.out || '(empty result)') : `OpenCode error: ${r.error || 'unknown'}`, via: `opencode/${thread.model}` }],
        toolLog: r.ok ? ['🤖 opencode agent run'] : [],
      });
      window.codeit?.usageRecord({ projectId, provider: 'opencode', model: thread.model, ms: Date.now() - t0, prompt: 0, completion: 0, ok: r.ok });
      onUsageTick?.();
      endRun(tid); return;
    }

    const t0 = Date.now();
    const use = { prompt: 0, completion: 0 };
    const onUsage = (u) => { use.prompt += u.prompt || 0; use.completion += u.completion || 0; };
    const file = opts.file || null;
    const withFile = file ? `${text}\n\n--- ATTACHED FILE (${file.path}) ---\n${file.content.slice(0, 12000)}` : text;
    const next = [...thread.msgs, { role: 'user', content: text }];
    const via = `${thread.provider}/${thread.model}`;
    patchThread(tid, { msgs: next });
    let acc = '';
    patchThread(tid, { msgs: [...next, { role: 'assistant', content: '', via }] });
    const push = (t) => {
      if (abortsRef.current.get(tid) !== ctrl) return;
      acc += t;
      setThreads((cur) => cur.map((x) => {
        if (x.id !== tid) return x;
        const c = [...x.msgs];
        c[c.length - 1] = { role: 'assistant', content: acc, via };
        return { ...x, msgs: c };
      }));
    };
    let succeeded = true;
    try {
      const sysMsg = planning ? sys + PLANNER_SUFFIX : sys;
      const canUseTools = !planning && PROVIDERS.find((p) => p.id === thread.provider)?.supportsTools && mcpTools.length > 0 && window.codeit;
      const history = [{ role: 'system', content: sysMsg }, ...next.map((m) => ({ role: m.role, content: m.content })).slice(-10)];
      history[history.length - 1] = { ...history[history.length - 1], content: withFile };
      if (canUseTools) {
        if (thread.provider === 'ollama' && !ollamaToolCapable(thread.model)) {
          push(`_Note: \`${thread.model}\` may not reliably emit tool calls. For reliable local tools use \`qwen3:8b\` or \`mistral:7b-instruct-v0.3-q4_0\`._\n\n`);
        }
        await chatWithTools({
          provider: thread.provider, model: thread.model, messages: history, mcpTools,
          onChunk: push, onUsage, signal: ctrl.signal,
          onToolCall: async (call) => {
            const out = await executeTool(tid, call);
            if (typeof out === 'string' && (out.startsWith('Tool error:') || out.startsWith('User denied'))) {
              const e = new Error(out); e.toolFailed = true; throw e;
            }
            return out;
          },
          onToolEvent: (e) => setThreads((cur) => cur.map((x) => x.id === tid
            ? { ...x, toolLog: [...x.toolLog, `${e.status === 'calling' ? '⚙️' : e.status === 'error' ? '❌' : '✅'} ${e.serverId}.${e.name}`] }
            : x)),
        });
      } else {
        if (!planning && mcpTools.length > 0 && !PROVIDERS.find((p) => p.id === thread.provider)?.supportsTools) {
          push(`_Note: ${thread.provider} is text-only here — MCP tools need Groq/DeepSeek/OpenRouter/Anthropic. Skills still apply._\n\n`);
        }
        await streamChat({ provider: thread.provider, model: thread.model, messages: history, onChunk: push, onUsage, signal: ctrl.signal });
      }
      if (planning) patchThread(tid, { planned: true });
    } catch (err) {
      succeeded = false;
      if (abortsRef.current.get(tid) !== ctrl) return;
      const msg = String(err.message || '');
      const isNoKey = err.code === 'NO_KEY';
      const sameModel = thread.errModel === via;
      const streak = isNoKey ? 0 : (sameModel ? (thread.errStreak || 0) + 1 : 1);
      patchThread(tid, { errStreak: streak, errModel: via });
      const streakMsg = streak >= 2 ? `\n\n_Failed ${streak}× on this model — switch models or fix keys._` : '';
      if (err && err.name === 'AbortError') {
        setThreads((cur) => cur.map((x) => {
          if (x.id !== tid) return x;
          const c = [...x.msgs]; c[c.length - 1] = { role: 'assistant', content: acc ? acc + '\n\n_Stopped._' : '_Stopped._', via };
          return { ...x, msgs: c };
        }));
        window.codeit?.usageRecord({ projectId, provider: thread.provider, model: thread.model, ms: Date.now() - t0, prompt: use.prompt, completion: use.completion, ok: false });
        onUsageTick?.(); endRun(tid); return;
      }
      const status = typeof err.status === 'number' ? err.status : 0;
      const notFound = status === 404 || status === 410 || (status >= 400 && status < 500 && status !== 401 && status !== 403 && isDeadFailure(msg));
      if (notFound) markDead(canonProvider(thread.provider), thread.model, msg);
      else if (!isNoKey && status !== 401 && status !== 403 && streak >= 2 && isTempDeadFailure(msg)) {
        markDead(canonProvider(thread.provider), thread.model, msg, TEMP_DEAD_TTL_MS);
      }
      const hint = err.code === 'NO_KEY' ? String(err.message)
        : /model_not_found|does not exist|no longer available|deprecated|retired/i.test(msg) ? `${msg} — Tip: that model is retired. Open model picker and choose another.`
        : /credit|billing|balance/i.test(msg) ? `${msg} — Tip: top up that provider, or switch to Groq free tier.`
        : /failed to fetch|networkerror|network error|load failed/i.test(msg) ? `${msg} — Tip: check connection, VPN, or proxy.`
        : /\b5\d\d\b/.test(msg) ? `${msg} — Tip: provider is erroring, wait a minute and retry.`
        : thread.provider === 'ollama' ? `${msg} — Tip: run \`ollama serve\` and \`ollama pull ${thread.model}\`.`
        : `${msg} — Tip: check the key in Keys, or switch to Groq free tier.`;
      setThreads((cur) => cur.map((x) => {
        if (x.id !== tid) return x;
        const c = [...x.msgs]; c[c.length - 1] = { role: 'assistant', content: (acc ? acc + '\n\n' + hint : hint) + streakMsg, via };
        return { ...x, msgs: c };
      }));
    }
    if (abortsRef.current.get(tid) !== ctrl) return;
    const cost = costUSD(thread.model, use.prompt, use.completion);
    if (succeeded) patchThread(tid, { errStreak: 0 });
    patchThread(tid, { lastUsage: { ...use, cost } });
    window.codeit?.usageRecord({ projectId, provider: thread.provider, model: thread.model, ms: Date.now() - t0, prompt: use.prompt, completion: use.completion, ok: succeeded });
    onUsageTick?.();
    endRun(tid);
  }

  async function sendToThread(threadId, text) {
    const t = threads.find((x) => x.id === threadId);
    const clean = String(text || '').trim();
    if (!t || !clean || busyIds.includes(threadId)) return;

    // Free image generation: /image <prompt> or "generate image of ..."
    if (clean.startsWith('/image ') || clean.toLowerCase().startsWith('generate image:')) {
      const prompt = clean.replace(/^\/image\s+|generate image:\s*/i, '').trim();
      if (prompt) {
        const seed = Math.floor(Math.random() * 1000000);
        const encoded = encodeURIComponent(prompt);
        const imgUrl = `https://image.pollinations.ai/prompt/${encoded}?width=800&height=600&seed=${seed}&nologo=true&model=flux`;
        const next = [
          ...t.msgs,
          { role: 'user', content: clean },
          {
            role: 'assistant',
            content: `🎨 Generated image for: **${prompt}**\n\n![${prompt}](${imgUrl})\n\n[Open high-res ↗](${imgUrl})`,
            via: 'free-flux/pollinations'
          }
        ];
        patchThread(threadId, { msgs: next, updatedAt: new Date().toISOString() });
        return;
      }
    }

    const file = fileContext || null;
    if (file) setFileContext?.(null);
    const sys = await buildCtx(clean, t);
    await runThread(t, clean, sys, { file });
  }

  async function sendBroadcast() {
    const text = broadcastInput.trim();
    if (!text || busyIds.length) return;
    if (text === '/plan') { setPlanMode(!planMode); setBroadcastInput(''); return; }
    const targets = colOrder.map((id) => threads.find((t) => t.id === id)).filter(Boolean);
    if (!targets.length) return;
    const file = fileContext || null;
    if (file?.path) {
      for (const t of targets) patchThread(t.id, { scope: [...new Set([...(t.scope || []), file.path])].slice(0, 20) });
    }
    setFileContext?.(null);
    setBroadcastInput('');
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      const sys = await buildCtx(text, t);
      // eslint-disable-next-line no-await-in-loop
      await runThread(t, text, sys, { file });
    }
  }

  function stopThread(tid) {
    abortsRef.current.get(tid)?.abort();
    const pending = approvalResolve.current[tid];
    if (pending) resolveApproval(tid, { denied: true });
  }

  function stopAll() {
    for (const ctrl of abortsRef.current.values()) ctrl.abort();
    for (const tid of Object.keys(approvalResolve.current)) {
      if (approvalResolve.current[tid]) resolveApproval(tid, { denied: true });
    }
    window.codeit?.opencodeCancel(project?.path || '');
  }

  async function retryThread(threadId) {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    const idx = [...thread.msgs].map((m) => m.role).lastIndexOf('user');
    if (idx < 0 || busyIds.length) return;
    const text = thread.msgs[idx].content;
    patchThread(threadId, { msgs: thread.msgs.slice(0, idx), planned: false });
    const sys = await buildCtx(text, thread);
    runThread({ ...thread, msgs: thread.msgs.slice(0, idx) }, text, sys);
  }

  async function executePlan(threadId) {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) return;
    const planMsg = [...thread.msgs].reverse().find((m) => m.role === 'assistant');
    if (!planMsg) return;
    setPlanMode(false);
    const sys = await buildCtx(`execute approved plan for ${project?.name || 'project'}`, thread);
    runThread(thread, `Approved plan — execute it now, step by step:\n\n${planMsg.content.slice(0, 6000)}`, sys, { planning: false });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const visibleThreads = colOrder.map((id) => threads.find((t) => t.id === id)).filter(Boolean);
  const anyBusy = busyIds.length > 0;
  const colCount = visibleThreads.length;

  // Grid layout class
  const gridClass = colCount === 1 ? 'arena-grid--1'
    : colCount === 2 ? 'arena-grid--2'
    : (colCount >= 3 && grid2x2) ? 'arena-grid--2x2'
    : colCount === 3 ? 'arena-grid--3'
    : 'arena-grid--4';

  return (
    <div className="arena">
      {/* Arena toolbar */}
      <div className="arena-bar">
        <div className="arena-bar-left">
          <span className="arena-label">
            {colCount === 1 ? '1 Model' : `${colCount} Models`}
          </span>
          {colCount < MAX_COLS && (
            <>
              <button className="btn btn-sm btn-ghost" onClick={addColumn} title="Add a new model column">
                + Add Model
              </button>
              <button className="btn btn-sm btn-ghost" onClick={addSmartColumn} title="Add a column with a different working model auto-selected">
                + Smart Pick
              </button>
            </>
          )}
        </div>
        <div className="arena-bar-center" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {colCount >= 3 && (
            <button
              className={`btn btn-sm${grid2x2 ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => setGrid2x2(!grid2x2)}
              title={grid2x2 ? 'Switch to side-by-side vertical columns' : 'Switch to 2x2 grid view'}
            >
              {grid2x2 ? '⊞ 2×2 Grid' : '|||| Columns'}
            </button>
          )}
          {colCount > 1 && (
            <button
              className={`btn btn-sm${broadcastMode ? ' btn-primary' : ' btn-ghost'}`}
              onClick={() => setBroadcastMode(!broadcastMode)}
              title="Broadcast: send the same prompt to all visible models at once"
              aria-pressed={broadcastMode}
            >
              {broadcastMode ? '📡 Broadcasting' : '📡 Broadcast'}
            </button>
          )}
        </div>
        <div className="arena-bar-right">
          <button
            className={`btn btn-sm${planMode ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => setPlanMode(!planMode)}
            title="Plan mode: model plans first, you approve, then executes"
            aria-pressed={planMode}
          >
            {planMode ? '📋 Planning' : '📋 Plan'}
          </button>
          {anyBusy && (
            <button className="btn btn-sm btn-danger" onClick={stopAll} title="Stop all running models">
              ⏹ Stop All
            </button>
          )}
        </div>
      </div>

      {/* Broadcast bar */}
      {broadcastMode && colCount > 1 && (
        <div className="broadcast-bar">
          <span className="broadcast-label">📡 Send to all {colCount} models:</span>
          <div className="col-composer-wrap" style={{ flex: 1 }}>
            {bcSlashOpen && (
              <SlashMenu
                filter={bcSlashFilter}
                selected={bcSlashIdx}
                onSelect={(cmd) => {
                  setBroadcastInput(cmd + ' ');
                  setBcSlashOpen(false);
                  setBcSlashIdx(0);
                }}
                onClose={() => setBcSlashOpen(false)}
              />
            )}
            <textarea
              className="broadcast-input"
              rows={1}
              value={broadcastInput}
              onChange={(e) => {
                const val = e.target.value;
                setBroadcastInput(val);
                if (val.startsWith('/') && !val.includes(' ')) {
                  setBcSlashFilter(val.slice(1));
                  setBcSlashOpen(true);
                  setBcSlashIdx(0);
                } else {
                  setBcSlashOpen(false);
                }
              }}
              onKeyDown={(e) => {
                if (bcSlashOpen) {
                  const visible = SLASH_COMMANDS.filter((c) => c.cmd.startsWith('/' + bcSlashFilter));
                  if (e.key === 'ArrowDown') { e.preventDefault(); setBcSlashIdx((i) => (i + 1) % Math.max(1, visible.length)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setBcSlashIdx((i) => (i - 1 + visible.length) % Math.max(1, visible.length)); return; }
                  if (e.key === 'Tab' || (e.key === 'Enter' && visible.length > 0)) {
                    e.preventDefault();
                    const item = visible[bcSlashIdx] || visible[0];
                    if (item) { setBroadcastInput(item.cmd + ' '); setBcSlashOpen(false); setBcSlashIdx(0); }
                    return;
                  }
                  if (e.key === 'Escape') { e.preventDefault(); setBcSlashOpen(false); return; }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBroadcast(); }
              }}
              onBlur={() => { setTimeout(() => setBcSlashOpen(false), 150); }}
              placeholder={`Ask all ${colCount} models… (/ for commands, Enter to send)`}
              disabled={anyBusy}
            />
          </div>
          {anyBusy
            ? <button className="btn btn-danger btn-sm" onClick={stopAll}>⏹ Stop</button>
            : <button className="btn btn-primary btn-sm" onClick={sendBroadcast} disabled={!broadcastInput.trim()}>
                Send to {colCount}
              </button>
          }
        </div>
      )}

      {/* Model columns */}
      <div className={`arena-grid ${gridClass}`}>
        {visibleThreads.map((thread) => (
          <ModelColumn
            key={thread.id}
            thread={thread}
            busy={busyIds.includes(thread.id)}
            planMode={planMode}
            onPick={pickModel}
            onSend={sendToThread}
            onStop={stopThread}
            onRetry={retryThread}
            onExecutePlan={executePlan}
            onClear={clearThread}
            onClone={cloneColumn}
            onClose={removeColumn}
            canClose={colCount > 1}
            colCount={colCount}
            fileContext={fileContext}
          />
        ))}
      </div>

      {/* Tool approval overlay */}
      {(() => {
        const entry = Object.entries(pendings)[0];
        return entry ? <ToolApproval pending={entry[1]} onResolve={(d) => resolveApproval(entry[0], d)} /> : null;
      })()}
    </div>
  );
}
