import { useEffect, useRef, useState } from 'react';
import { Empty } from './ui.jsx';

// Local image generation via the CodeIT SDXL quality server (Mac: Pony V6 XL, MPS fp16).
// Server: servers/sdxl/server_sdxl_mac.py on http://127.0.0.1:8002 (/info + /generate).
// No API key, runs on your hardware. Save to project drops PNGs in .codeit/images/.
const HOST = 'http://127.0.0.1:8002';
const SIZES = [
  { id: '1:1', label: 'Square 1024²', w: 1024, h: 1024 },
  { id: '3:4', label: 'Portrait 896×1152', w: 896, h: 1152 },
  { id: '16:9', label: 'Wide 1216×704', w: 1216, h: 704 },
];

export default function ImagesPane({ project }) {
  const [ready, setReady] = useState(null); // null=unknown, true/false
  const [info, setInfo] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState(SIZES[0]);
  const [steps, setSteps] = useState(28);
  const [seed, setSeed] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds since generate started
  const timer = useRef(null);
  const [gallery, setGallery] = useState([]); // [{src, seed, ms, prompt}]
  const [err, setErr] = useState('');

  async function ping() {
    try {
      const r = await fetch(`${HOST}/info`);
      const j = await r.json();
      setInfo(j);
      setReady(!!j.ready);
      if (!j.ready) setErr(j.error || 'model not loaded — check server log');
      else setErr('');
    } catch {
      // Server may still be starting (app-managed) — ask main to ensure it.
      try { await window.codeit?.imagesEnsure?.(); } catch {}
      setReady(false);
      setErr('');
    }
  }
  useEffect(() => {
    ping();
    // Poll while the (app-managed) server warms up; stop once ready.
    const t = setInterval(async () => {
      try {
        const r = await fetch(`${HOST}/info`);
        const j = await r.json();
        if (j.ready) { setInfo(j); setReady(true); setErr(''); clearInterval(t); }
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, []);

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
        body: JSON.stringify({ prompt: prompt.trim(), width: size.w, height: size.h, steps, seed }),
      });
      if (!r.ok) throw new Error(`server ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      setGallery((g) => [{ src: `data:image/png;base64,${j.image_b64}`, seed: j.seed, ms: j.ms, prompt: prompt.trim(), b64: j.image_b64 }, ...g].slice(0, 12));
    } catch (e) {
      setErr(String(e.message || e).slice(0, 300));
    }
    clearInterval(timer.current);
    setBusy(false);
  }

  useEffect(() => () => clearInterval(timer.current), []);

  function fmtElapsed(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function stage(s) {
    if (s < 12) return 'warming up the model…';
    if (s < 45) return `denoising… (${steps} steps on MPS)`;
    return 'refining details — almost there…';
  }

  async function saveImage(item) {
    if (!window.codeit?.imagesSave) return;
    const name = `img_${new Date().toISOString().replace(/[:.]/g, '-')}_s${item.seed}.png`;
    const r = await window.codeit.imagesSave(project ? project.path : null, name, item.b64);
    if (!r.ok) setErr(`save failed: ${r.error}`);
    else setErr(`saved: ${r.path}`);
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
          Starting the local server (first launch loads ~5GB, takes a few minutes)…
          If this persists, check <code>~/PonyServer/sdxl.codeit.log</code> or start manually —
          see <code>servers/sdxl/README.md</code>.
        </div>
      )}
      {err && <div className="pad" style={{ fontSize: 12, color: 'var(--amber)' }}>{err}</div>}
      <div className="pad stack">
        <label className="sr-only" htmlFor="codeit-img-prompt">Image prompt</label>
        <textarea id="codeit-img-prompt" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
          placeholder="A workspace desk at night, neon, pony score style… (⌘+Enter generates)"
          style={{ background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 6, padding: 8, fontSize: 13, resize: 'vertical' }} />
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select aria-label="Image size" value={size.id} onChange={(e) => setSize(SIZES.find((s) => s.id === e.target.value))}>
            {SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <label style={{ fontSize: 12, color: 'var(--dim)' }}>Steps
            <input type="number" min={5} max={60} value={steps} onChange={(e) => setSteps(+e.target.value || 28)} style={{ width: 56, marginLeft: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--dim)' }}>Seed
            <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value || 0)} placeholder="-1 random" style={{ width: 90, marginLeft: 4 }} />
          </label>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={generate} disabled={busy || !ready}>{busy ? `Rendering… ${fmtElapsed(elapsed)}` : 'Generate'}</button>
        </div>
        {busy && (
          <div role="status" aria-live="polite" style={{ padding: '2px 0' }}>
            <div className="pbar"><div className="pbar-fill" /></div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
              {stage(elapsed)} · {fmtElapsed(elapsed)} elapsed · typical 1024² takes 1–3 min on MPS
            </div>
          </div>
        )}
      </div>
      <div className="pane-body scroll pad stack">
        {gallery.length === 0 && <Empty>Nothing yet — renders appear here. A 1024² image takes ~1–3 min on MPS.</Empty>}
        {gallery.map((g, i) => (
          <div key={i} className="card">
            <img src={g.src} alt={g.prompt} style={{ width: '100%', borderRadius: 6 }} />
            <div className="sub" style={{ whiteSpace: 'normal', marginTop: 4 }}>{g.prompt}</div>
            <div className="row" style={{ marginTop: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--dim)', flex: 1 }}>seed {g.seed} · {(g.ms / 1000).toFixed(1)}s</span>
              <button className="btn btn-sm" onClick={() => saveImage(g)} title={project ? 'Save into <project>/.codeit/images/' : 'No project selected — saves into Downloads/CodeIT-images/'}>
                {project ? 'Save to project' : 'Save to Downloads'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
