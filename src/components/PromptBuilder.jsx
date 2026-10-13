import { useState } from 'react';
import { streamChat } from '../llm/router.js';

// Guided prompt builder: 2-3 words in, production-ready prompt out.
// mode 'video': flowing paragraph (subject + motion + camera + light) for LTX.
// mode 'image': same + Pony score-tag header for SDXL Pony.
const MOTIONS = ['slow breathing', 'slight head turn', 'hair swaying gently', 'slow push-in', 'fixed tripod', 'walking slowly', 'turning toward camera', 'fabric drifting', 'water rippling', 'blinking slowly'];
const CAMERAS = ['fixed medium shot at eye level', 'slow push-in', 'side tracking shot', 'close-up', 'wide establishing shot', 'over-the-shoulder', 'low angle', 'handheld following'];
const LIGHTS = ['warm directional key light from screen-left with soft rim light', 'soft moonlight from above', 'golden-hour backlight', 'neon glow with deep shadows', 'soft window light, overcast daylight', 'candlelight, warm and flickering'];
const STYLE_TAILS = {
  video: 'Real-life footage, natural motion.',
  image: 'photorealistic detail, natural skin texture',
};
const NEGATIVES = {
  none: '',
  figure: 'deformed hands, extra limbs, bad anatomy, morphing face, flickering, watermark, text',
  general: 'worst quality, blurry, jittery, distorted, watermark, text',
};

export default function PromptBuilder({ mode = 'video', initial = '', onUse }) {
  const [subject, setSubject] = useState(initial);
  const [motion, setMotion] = useState(mode === 'video' ? 'slow breathing, slight head turn' : '');
  const [camera, setCamera] = useState('fixed medium shot at eye level');
  const [light, setLight] = useState(LIGHTS[0]);
  const [negative, setNegative] = useState('figure');
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState('');

  function compose(s = subject, m = motion) {
    const parts = [s.trim()];
    if (m.trim() && mode === 'video') parts.push(m.trim());
    parts.push(`${camera}.`);
    parts.push(`${light}.`);
    parts.push(STYLE_TAILS[mode]);
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function ollamaModel() {
    // Prefer a prose-capable local model; fall back to anything installed.
    return fetch('http://127.0.0.1:11434/api/tags')
      .then((r) => r.json())
      .then((j) => {
        const names = (j.models || []).map((x) => x.name);
        return names.find((n) => n.startsWith('qwen3')) || names.find((n) => n.includes('mistral'))
          || names.find((n) => n.includes('llama3.1')) || names.find((n) => n.includes('qwen2.5'))
          || names[0];
      });
  }

  async function enhance() {
    if (!subject.trim() || enhancing) return;
    setEnhancing(true);
    setError('');
    try {
      const model = await ollamaModel();
      if (!model) throw new Error('Ollama has no models — pull one first (`ollama pull qwen3:8b`).');
      const sys = mode === 'video'
        ? 'Expand the user\'s 2-4 word idea into ONE flowing video-generation paragraph: subject with 2-3 visual details, then one simple motion, then camera framing, then lighting. Present tense. 3-5 sentences. No instructions, no preamble, no quotes — output ONLY the paragraph.'
        : 'Expand the user\'s 2-4 word idea into ONE rich image prompt: subject with visual details, setting, lighting, photographic style. One flowing paragraph. No preamble, no quotes — output ONLY the prompt.';
      let acc = '';
      await streamChat({
        provider: 'ollama', model,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: subject.trim() }],
        onChunk: (t) => { acc += t; },
      });
      acc = acc.trim().replace(/^["']|["']$/g, '');
      if (acc) {
        // Keep the structured fields in sync: enhanced text becomes the subject,
        // motion/camera/light stay as chosen refinements (video) or drop (image).
        if (mode === 'video') { setSubject(acc); }
        else setSubject(acc);
      }
    } catch (e) {
      setError(`Enhance needs local Ollama running: ${String(e.message || e).slice(0, 160)}`);
    }
    setEnhancing(false);
  }

  const preview = mode === 'image'
    ? `score_9, score_8_up, score_7_up, ${compose()}`
    : compose();

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: 13, flex: 1 }}>Prompt builder</strong>
        <button className="btn btn-sm" disabled={enhancing || !subject.trim()} onClick={enhance} title="Expand with local Ollama">
          {enhancing ? 'Enhancing…' : '✨ Enhance'}
        </button>
      </div>
      <label style={{ fontSize: 12, color: 'var(--dim)' }}>Subject — 2 or 3 words is fine
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="sexy lady with silver hair"
          style={{ width: '100%', marginTop: 4 }} />
      </label>
      {mode === 'video' && (
        <label style={{ fontSize: 12, color: 'var(--dim)' }}>Motion
          <input value={motion} onChange={(e) => setMotion(e.target.value)} list="codeit-motions"
            placeholder="slow breathing, slight head turn" style={{ width: '100%', marginTop: 4 }} />
          <datalist id="codeit-motions">{MOTIONS.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
      )}
      <div className="row">
        <label style={{ fontSize: 12, color: 'var(--dim)', flex: 1 }}>Camera
          <select value={camera} onChange={(e) => setCamera(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
            {CAMERAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, color: 'var(--dim)', flex: 1 }}>Light
          <select value={light} onChange={(e) => setLight(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
            {LIGHTS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 12, color: 'var(--dim)' }}>Negative preset
        <select value={negative} onChange={(e) => setNegative(e.target.value)} style={{ width: '100%', marginTop: 4 }}>
          <option value="figure">Figure (hands/anatomy guard)</option>
          <option value="general">General quality</option>
          <option value="none">None</option>
        </select>
      </label>
      {error && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{error}</div>}
      <div style={{ fontSize: 12, background: 'var(--bg1)', borderRadius: 6, padding: 8, marginTop: 6, whiteSpace: 'pre-wrap' }}>
        {preview || <span style={{ color: 'var(--dim)' }}>Type a subject to preview…</span>}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-primary" disabled={!preview} onClick={() => onUse({ prompt: preview, negative: NEGATIVES[negative] })}>
          Use this prompt
        </button>
      </div>
    </div>
  );
}
