import { useEffect, useRef, useState } from 'react';

const API_BASE = 'http://127.0.0.1:8003';

export default function ImageGenPane() {
  const [prompt, setPrompt] = useState('score_9, score_8_up, cinematic portrait, detailed armor, golden hour, 8k');
  const [negative, setNegative] = useState('');
  const [steps, setSteps] = useState(28);
  const [guidance, setGuidance] = useState(7.0);
  const [seed, setSeed] = useState(42);
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [images, setImages] = useState([]);
  const [servers, setServers] = useState({ pony: { running: false }, turbo: { running: false } });
  const [starting, setStarting] = useState({});
  const [prog, setProg] = useState({ step: 0, total: 0, running: false });
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    checkStatus();
    const id = setInterval(checkStatus, 10000);
    return () => clearInterval(id);
  }, []);

  async function checkStatus() {
    try {
      const s = await window.codeit.imgserversStatus();
      setServers(s);
    } catch {}
  }

  async function startServer(key) {
    setStarting((s) => ({ ...s, [key]: true }));
    try {
      const r = await window.codeit.imgserversStart(key);
      if (r.ok) {
        checkStatus();
      } else {
        setErr(`Failed to start ${key}: ${r.error}`);
      }
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setStarting((s) => ({ ...s, [key]: false }));
    }
  }

  async function generate() {
    if (busy) return;
    if (!servers.pony?.running) {
      setErr('Pony server not running — click "Start Pony" below');
      return;
    }
    setErr('');
    setBusy(true);
    setProg({ step: 0, total: Number(steps), running: true });
    setElapsed(0);
    const t0 = Date.now();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const elapsedId = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    const progId = setInterval(async () => {
      try {
        const pc = new AbortController();
        const to = setTimeout(() => pc.abort(), 5000);
        const pr = await fetch(`${API_BASE}/progress`, { signal: pc.signal });
        clearTimeout(to);
        if (pr.ok) {
          const pj = await pr.json();
          setProg({ step: pj.step || 0, total: pj.total || Number(steps), running: !!pj.running });
        }
      } catch { /* server busy serializing — elapsed timer keeps ticking */ }
    }, 2000);
    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          inference_steps: Number(steps),
          guidance_scale: Number(guidance),
          seed: Number(seed),
          width: Number(width),
          height: Number(height),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      if (!data.image) throw new Error('No image in response');
      const newImage = {
        src: `data:image/png;base64,${data.image}`,
        prompt: prompt.trim(),
        params: { steps, guidance, seed, width, height },
        latency: data.latency,
      };
      setImages((prev) => [newImage, ...prev].slice(0, 20));
    } catch (e) {
      if (e.name === 'AbortError') return;
      setErr(String(e.message || e));
    } finally {
      clearInterval(elapsedId);
      clearInterval(progId);
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="imagegen">
      <div className="toolbar">
        <span className="badge blue" title="Runs on local OpenVINO — no key, no cloud">local · OpenVINO · uncensored</span>
        <span className="spacer" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: servers.pony?.running ? '#3fb950' : '#f85149' }}>
            {servers.pony?.running ? '● Pony ready' : '○ Pony offline'}
          </span>
          {!servers.pony?.running && !starting.pony && (
            <button className="btn btn-sm btn-primary" onClick={() => startServer('pony')}>Start Pony</button>
          )}
          {starting.pony && <span className="muted" style={{ fontSize: 11 }}>Starting…</span>}
          <span style={{ fontSize: 11, color: servers.turbo?.running ? '#3fb950' : '#f85149', marginLeft: 8 }}>
            {servers.turbo?.running ? '● Turbo ready' : '○ Turbo offline'}
          </span>
          {!servers.turbo?.running && !starting.turbo && (
            <button className="btn btn-sm btn-ghost" onClick={() => startServer('turbo')}>Start Turbo</button>
          )}
          {starting.turbo && <span className="muted" style={{ fontSize: 11 }}>Starting…</span>}
        </div>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => setImages([])}>Clear gallery</button>
      </div>
      {err && <div className="uncensored-err" role="alert">⚠ {err}</div>}
      <div className="col-messages" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 12, overflow: 'auto' }}>
        {images.map((img, i) => (
          <div key={i} className="img-card" style={{ width: 220, flexShrink: 0 }}>
            <img src={img.src} alt={img.prompt} style={{ width: '100%', borderRadius: 6 }} />
            <div className="img-meta" style={{ fontSize: 10, marginTop: 4, color: 'var(--dim)' }}>
              {img.latency?.toFixed(1)}s · {img.params.steps} steps · cfg {img.params.guidance} · {img.params.width}×{img.params.height} · seed {img.params.seed}
            </div>
            <div className="img-prompt" style={{ fontSize: 10, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {img.prompt.slice(0, 80)}{img.prompt.length > 80 ? '…' : ''}
            </div>
          </div>
        ))}
        {images.length === 0 && !busy && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', padding: 40 }}>
            <div style={{ fontSize: 32 }}>🖼</div>
            <div style={{ marginTop: 8 }}>No images yet — generate your first</div>
          </div>
        )}
        {busy && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)', padding: 40, gap: 10 }}>
            <div style={{ fontSize: 32 }}>⏳</div>
            <div style={{ width: 280, height: 8, borderRadius: 4, background: 'var(--bg3)', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: prog.total > 0 ? `${Math.min(100, Math.round((prog.step / prog.total) * 100))}%` : '100%',
                background: 'var(--accent)',
                opacity: prog.total > 0 ? 1 : 0.5,
                transition: 'width 1s',
              }} />
            </div>
            <div style={{ fontSize: 12 }}>
              {prog.total > 0 && prog.step > 0
                ? `Step ${prog.step} / ${prog.total} · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                : `Warming up… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
            </div>
          </div>
        )}
      </div>
      <div className="col-composer" style={{ padding: '8px 12px' }}>
        <div className="col-composer-row" style={{ flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="sr-only" htmlFor="img-prompt">Prompt</label>
              <textarea
                id="img-prompt"
                className="col-input"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Prompt (Pony tags: score_9, score_8_up, source_anime, …)"
                disabled={busy}
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="sr-only" htmlFor="img-negative">Negative prompt</label>
              <textarea
                id="img-negative"
                className="col-input"
                rows={3}
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                placeholder="Negative prompt (optional)"
                disabled={busy}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>Steps <input type="number" className="col-input" style={{ width: 60 }} value={steps} onChange={(e) => setSteps(Math.max(1, Math.min(50, Number(e.target.value))))} min={1} max={50} disabled={busy} /></label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>CFG <input type="number" step="0.5" className="col-input" style={{ width: 60 }} value={guidance} onChange={(e) => setGuidance(Math.max(1, Math.min(20, Number(e.target.value))))} min={1} max={20} disabled={busy} /></label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>Seed <input type="number" className="col-input" style={{ width: 80 }} value={seed} onChange={(e) => setSeed(Math.max(-1, Number(e.target.value)))} min={-1} disabled={busy} /></label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>W <input type="number" className="col-input" style={{ width: 60 }} value={width} onChange={(e) => setWidth(Math.max(512, Math.min(1536, Number(e.target.value))))} min={512} max={1536} step={64} disabled={busy} /></label>
            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>H <input type="number" className="col-input" style={{ width: 60 }} value={height} onChange={(e) => setHeight(Math.max(512, Math.min(1536, Number(e.target.value))))} min={512} max={1536} step={64} disabled={busy} /></label>
            <span className="spacer" />
            {busy ? (
              <button className="btn btn-danger" onClick={stop} disabled={!busy}>Stop</button>
            ) : (
              <button className="btn btn-primary" onClick={generate} disabled={busy || !prompt.trim() || !servers.pony?.running}>Generate</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}