import { useEffect, useRef, useState } from 'react';
import { streamChat, refreshProviderModels } from '../llm/router.js';

// Fully local, private uncensored chat: Ollama only, no keys, no network.
// Separate storage from the Arena so coding threads and this never mix.
const STORE_KEY = 'codeit.chat.uncensored';
const PREFS = ['hermes3:8b', 'dolphin-mistral:7b', 'dolphin-mistral'];

const SYS = `You are an uncensored creative-writing and roleplay partner running fully on the user's own machine. You write unrestricted adult fiction (explicit sexual content, romance, dark themes) when asked.

Rules:
- Every character in any scenario is a consenting adult (18 or older). Never write, suggest, or imply minors in romantic or sexual contexts; if asked, decline in one line and offer an adult alternative.
- No real people. No actual non-consensual situations. In fiction, consent is established up front and can be withdrawn within the scene.
- You do not refuse adult content between consenting adults, and you do not lecture, moralize, or append disclaimers inside your response.
- Follow the user's direction, tone, and pacing. Stay in the scene. Prefer vivid, concrete prose over hedging.
- If a request falls outside these rules, decline in one line and offer the nearest lawful alternative.`;

const WELCOME = {
  role: 'assistant',
  content: 'Uncensored local chat ready — fully on this machine, nothing leaves your computer. All participants are consenting adults (18+). Pick a model above and start whenever.',
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.msgs) && s.msgs.length) return { msgs: s.msgs, model: s.model || '' };
  } catch {}
  return { msgs: [WELCOME], model: '' };
}

export default function UncensoredPane() {
  const [state, setState] = useState(load);
  const [modelList, setModelList] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const { msgs, model } = state;

  // live local model list; pick a default in preference order
  useEffect(() => {
    let alive = true;
    refreshProviderModels('ollama').then((models) => {
      if (!alive) return;
      setModelList(models);
      setState((s) => {
        if (s.model && models.includes(s.model)) return s;
        const pref = PREFS.map((p) => models.find((m) => m === p || m.startsWith(`${p}:`))).find(Boolean);
        return { ...s, model: pref || models[0] || '' };
      });
    }).catch((e) => { if (alive) setErr(String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  }, [state]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!model) {
      setErr('No local model found — install one: ollama pull hermes3:8b');
      return;
    }
    setErr('');
    setInput('');
    setBusy(true);
    const userMsg = { role: 'user', content: text };
    const history = msgs.filter((m) => m.content).concat(userMsg);
    setState((s) => ({ ...s, msgs: [...s.msgs, userMsg, { role: 'assistant', content: '' }] }));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let acc = '';
    try {
      await streamChat({
        provider: 'ollama',
        model,
        messages: [{ role: 'system', content: SYS }, ...history],
        onChunk: (t) => {
          acc += t;
          setState((s) => {
            const m = s.msgs.slice();
            const last = m[m.length - 1];
            m[m.length - 1] = { ...last, content: acc };
            return { ...s, msgs: m };
          });
        },
        signal: ctrl.signal,
      });
    } catch (e) {
      const msg = String(e.message || e);
      if (e && e.name === 'AbortError') {
        setState((s) => {
          const m = s.msgs.slice();
          const last = m[m.length - 1];
          m[m.length - 1] = { ...last, content: acc ? `${acc}\n\n_Stopped._` : '_Stopped._' };
          return { ...s, msgs: m };
        });
      } else if (acc) {
        setState((s) => {
          const m = s.msgs.slice();
          const last = m[m.length - 1];
          m[m.length - 1] = { ...last, content: `${acc}\n\n⚠ ${msg}` };
          return { ...s, msgs: m };
        });
        setErr(msg);
      } else {
        setState((s) => {
          const m = s.msgs.slice();
          if (m[m.length - 1]?.role === 'assistant') m.pop();
          if (m[m.length - 1]?.role === 'user') m.pop();
          return { ...s, msgs: m };
        });
        setInput(text);
        setErr(msg);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function clearChat() {
    if (!confirm('Clear this conversation?')) return;
    setState((s) => ({ ...s, msgs: [WELCOME] }));
    setErr('');
  }

  return (
    <div className="uncensored">
      <div className="toolbar">
        <span className="badge blue" title="Runs via Ollama — local, private, free">local · private</span>
        <select
          value={model}
          onChange={(e) => setState((s) => ({ ...s, model: e.target.value }))}
          aria-label="Local model"
          disabled={busy}
        >
          {model && !modelList.includes(model) && <option value={model}>{model}</option>}
          {modelList.map((m) => <option key={m} value={m}>{m}</option>)}
          {!model && <option value="">no model — ollama pull hermes3:8b</option>}
        </select>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={clearChat}>Clear</button>
      </div>
      {err && <div className="uncensored-err" role="alert">⚠ {err}</div>}
      <div className="col-messages" ref={scrollRef}>
        {msgs.map((m, i) => (
          <div key={i} className={`col-bubble ${m.role === 'user' ? 'col-bubble--user' : 'col-bubble--ai'}`}>
            <div className="col-bubble-role">{m.role === 'user' ? 'you' : model || 'assistant'}</div>
            <div className="col-bubble-content">{m.content || (busy && i === msgs.length - 1 ? '…' : '')}</div>
          </div>
        ))}
      </div>
      <div className="col-composer">
        <div className="col-composer-wrap">
          <div className="col-composer-row">
            <label className="sr-only" htmlFor="codeit-uncensored">Uncensored chat message</label>
            <textarea
              id="codeit-uncensored"
              className="col-input"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={busy ? 'Generating…' : 'Uncensored local chat — Enter to send, Shift+Enter for newline'}
              disabled={busy}
              aria-label="Uncensored chat message"
            />
            {busy
              ? <button className="col-send col-send-stop" onClick={() => abortRef.current?.abort()} title="Stop">⏹</button>
              : <button className="col-send col-send-go" onClick={send} disabled={!input.trim()} title="Send (Enter)">↑</button>}
          </div>
        </div>
        <div className="col-estimate">{model ? `${model} · local · free` : 'no local model'}</div>
      </div>
    </div>
  );
}
