import { useEffect, useState } from 'react';
import { costUSD, fmtCost, fmtTokens } from '../llm/pricing.js';

// Status whisper: branch + tools + session totals. Local-only sessions show FREE.
export default function StatusBar({ project, git, toolCount, usageTick, zen, setZen, onPalette }) {
  const [totals, setTotals] = useState({ calls: 0, prompt: 0, completion: 0, cost: 0, known: true, localOnly: true });
  const [build, setBuild] = useState(null);
  useEffect(() => { window.codeit?.buildInfo?.().then(setBuild).catch(() => {}); }, []);
  useEffect(() => {
    (async () => {
      if (!window.codeit?.usageGet) return;
      const data = await window.codeit.usageGet();
      const rows = Object.values(data.byKey || {});
      let calls = 0, prompt = 0, completion = 0, cost = 0, known = true, localOnly = true;
      for (const r of rows) {
        calls += r.calls; prompt += r.prompt; completion += r.completion;
        const c = costUSD(r.model, r.prompt, r.completion);
        if (c == null) known = false; else cost += c;
        if (!['ollama', 'opencode'].includes(r.provider) && (r.prompt + r.completion) > 0) {
          // cloud provider with usage — check if actually free-tier $0
          if ((c || 0) > 0) localOnly = false;
        }
      }
      setTotals({ calls, prompt, completion, cost, known, localOnly: localOnly && calls > 0 });
    })();
  }, [usageTick]);
  return (
    <footer className="statusbar" aria-label="Status">
      <span>{project ? `${project.kind === 'github' ? '⬣' : '📁'} ${project.name}` : 'no project'}</span>
      {git.isRepo && <span>{git.branch || 'detached'}{git.dirty ? ` ●${git.dirty}` : ''}</span>}
      {toolCount > 0 && <span>🧰{toolCount}</span>}
      <span className="spacer" />
      {totals.calls > 0 && (
        <span className="cost" title="Session totals across all threads">
          {fmtTokens(totals.prompt + totals.completion)} · {totals.localOnly ? <span className="free">LOCAL · FREE</span> : `${fmtCost(totals.cost)}${totals.known ? '' : '+'}`}
        </span>
      )}
      {build && <span title={`Built ${build.date || 'unknown date'} — match this to the installer before reporting issues`}>v{build.version}·{build.commit}</span>}
      <button className="btn btn-ghost btn-sm" onClick={onPalette} title="Command palette (⌘K)">⌘K</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setZen(!zen)} title="Toggle zen mode">{zen ? 'Exit zen' : 'Zen'}</button>
    </footer>
  );
}
