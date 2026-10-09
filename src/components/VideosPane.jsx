import { useEffect, useRef, useState } from 'react';
import { Empty } from './ui.jsx';

// Local video generation via the CodeIT video server (Mac: LTX-Video 2B, MPS fp16).
// Server: servers/video/server_video_mac.py on http://127.0.0.1:8003 (/info + /generate).
// Sibling of the Images tab — image pipeline untouched. No API key, your hardware.
const HOST = 'http://127.0.0.1:8003';
const LENGTHS = [
  { id: 'short', label: '~1s (25 frames)', frames: 25 },
  { id: 'med', label: '~2s (49 frames)', frames: 49 },
  { id: 'long', label: '~4s (97 frames)', frames: 97 },
];
const SIZES = [
  { id: 'wide', label: '768×512', w: 768, h: 512 },
  { id: 'sq', label: '512×512', w: 512, h: 512 },
];

export default function VideosPane({ project }) {
  const [ready, setReady] = useState(null);
  const [info, setInfo] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [length, setLength] = useState(LENGTHS[1]);
  const [size, setSize] = useState(SIZES[0]);
  const [steps, setSteps] = useState(45);
  const [recipe, setRecipe] = useState('dev'); // dev (quality) | fast (distilled-style)
  const [seed, setSeed] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clips, setClips] = useState([]); // [{src, seed, ms, prompt, b64, fps}]
  const [err, setErr] = useState('');
  const timer = useRef(null);

  async function ping() {
    try {
      const r = await fetch(`${HOST}/info`);
      const j = await r.json();
      setInfo(j);
      setReady(!!j.ready);
      setErr(j.ready ? '' : (j.error || 'model not loaded — check server log'));
    } catch {
      // Video server starts lazily (14GB load) — ask main to ensure it.
      try { await window.codeit?.videosEnsure?.(); } catch {}
      setReady(false);
      setErr('');
    }
  }
  useEffect(() => {
    ping();
    // Poll while the (lazily started) server warms up; stop once ready.
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${HOST}/info`);
        const j = await r.json();
        if (j.ready) { setInfo(j); setReady(true); setErr(''); clearInterval(t); }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => clearInterval(timer.current), []);

  function fmtElapsed(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setErr('');
    const t0 = Date.now();
    setElapsed(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    try {
      const r = await fetch(`${HOST}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), width: size.w, height: size.h, frames: length.frames, steps, recipe, seed }),
      });
      if (!r.ok) throw new Error(`server ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      setClips((g) => [{
        src: `data:video/mp4;base64,${j.video_b64}`, seed: j.seed, ms: j.ms,
        prompt: prompt.trim(), b64: j.video_b64, fps: j.fps, frames: j.frames,
      }, ...g].slice(0, 8));
    } catch (e) {
      setErr(String(e.message || e).slice(0, 300));
    }
    clearInterval(timer.current);
    setBusy(false);
  }

  async function saveClip(item) {
    if (!window.codeit?.videosSave) return;
    const name = `clip_${new Date().toISOString().replace(/[:.]/g, '-')}_s${item.seed}.mp4`;
    const r = await window.codeit.videosSave(project ? project.path : null, name, item.b64);
    setErr(r.ok ? `saved: ${r.path}` : `save failed: ${r.error}`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="toolbar">
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>
          {ready == null ? 'checking server…' : ready ? `● ${info?.model?.split('/').pop()} · ${info?.device} ${info?.dtype} · LOCAL · FREE` : '○ server offline'}
        </span>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={ping} title="Recheck">↻</button>
      </div>
      {ready === false && (
        <div className="pad" style={{ fontSize: 12, color: 'var(--dim)', borderBottom: '1px solid var(--line)' }}>
          Starting the local server on first open (14GB load, takes several minutes)…
          If this persists, check <code>~/PonyServer/video.codeit.log</code> or start manually —
          see <code>servers/video/README.md</code>.
        </div>
      )}
      {err && <div className="pad" style={{ fontSize: 12, color: 'var(--amber)' }}>{err}</div>}
      <div className="pad stack">
        <label className="sr-only" htmlFor="codeit-vid-prompt">Video prompt</label>
        <textarea id="codeit-vid-prompt" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
          placeholder="A neon koi fish swimming through a night canal… (⌘+Enter generates)"
          style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, padding: 8, fontSize: 13, resize: 'vertical' }} />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select aria-label="Clip length" value={length.id} onChange={(e) => setLength(LENGTHS.find((s) => s.id === e.target.value))}>
            {LENGTHS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select aria-label="Video size" value={size.id} onChange={(e) => setSize(SIZES.find((s) => s.id === e.target.value))}>
            {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select aria-label="Recipe" value={recipe} onChange={(e) => setRecipe(e.target.value)} title="dev: full quality (slower) · fast: distilled-style (quicker, softer)">
            <option value="dev">Recipe: quality</option>
            <option value="fast">Recipe: fast</option>
          </select>
          <label style={{ fontSize: 12, color: 'var(--dim)' }}>Steps
            <input type="number" min={5} max={60} value={steps} onChange={(e) => setSteps(+e.target.value || 30)} style={{ width: 56, marginLeft: 4 }} />
          </label>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={generate} disabled={busy || !ready}>{busy ? `Rendering… ${fmtElapsed(elapsed)}` : 'Generate'}</button>
        </div>
        {busy && (
          <div role="status" aria-live="polite">
            <div className="pbar"><div className="pbar-fill" /></div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
              diffusing {length.frames} frames… {fmtElapsed(elapsed)} elapsed · a 2s clip takes ~3–8 min on MPS
            </div>
          </div>
        )}
      </div>
      <div className="pane-body scroll pad stack">
        {clips.length === 0 && <Empty>Nothing yet — clips appear here with playback.</Empty>}
        {clips.map((c, i) => (
          <div key={i} className="card">
            <video src={c.src} controls loop muted playsInline style={{ width: '100%', borderRadius: 6, background: '#000' }} />
            <div className="sub" style={{ whiteSpace: 'normal', marginTop: 4 }}>{c.prompt}</div>
            <div className="row" style={{ marginTop: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--dim)', flex: 1 }}>seed {c.seed} · {c.frames}f@{c.fps}fps · {(c.ms / 1000).toFixed(0)}s render</span>
              <button className="btn btn-sm" onClick={() => saveClip(c)}>{project ? 'Save to project' : 'Save to Downloads'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
