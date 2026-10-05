import { useEffect, useState } from 'react';
import { costUSD, fmtCost, fmtTokens, fmtMs } from '../llm/pricing.js';
import { Empty } from './ui.jsx';

// Usage metering: per-provider/model calls, tokens, time, estimated cost.
// Source: usage.json via usage:get IPC (falls back to empty outside Electron).
export default function UsagePane({ refreshKey }) {
  const [data, setData] = useState({ events: [], byKey: {}, total: 0 });

  async function refresh() {
    if (window.codeit?.usageGet) setData(await window.codeit.usageGet());
  }
  useEffect(() => { refresh(); }, [refreshKey]);

  async function reset() {
    if (!confirm('Clear all usage history?')) return;
    if (window.codeit?.usageReset) await window.codeit.usageReset();
    refresh();
  }

  const rows = Object.values(data.byKey || {}).sort((a, b) =>
    (costUSD(b.model, b.prompt, b.completion) || 0) - (costUSD(a.model, a.prompt, a.completion) || 0));
  const grand = rows.reduce((s, r) => ({
    calls: s.calls + r.calls, prompt: s.prompt + r.prompt,
    completion: s.completion + r.completion, ms: s.ms + r.ms,
    cost: s.cost + (costUSD(r.model, r.prompt, r.completion) || 0),
    known: s.known && costUSD(r.model, r.prompt, r.completion) != null,
  }), { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, known: true });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: 12 }}>
      <div className="toolbar">
        <strong style={{ fontSize: 13 }}>Usage</strong>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={refresh} title="Refresh">↻</button>
        <button className="btn btn-sm btn-danger" onClick={reset} title="Clear history">Reset</button>
      </div>
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
        <span>Calls <strong>{grand.calls}</strong></span>
        <span>In <strong>{fmtTokens(grand.prompt)}</strong></span>
        <span>Out <strong>{fmtTokens(grand.completion)}</strong></span>
        <span>Time <strong>{fmtMs(grand.ms)}</strong></span>
        <span>Est. <strong>{grand.known ? fmtCost(grand.cost) : fmtCost(grand.cost) + '+'}</strong></span>
      </div>
      <div className="pane-body scroll pad stack">
        {rows.length === 0 && <Empty>No calls yet — send a chat to start metering. Local models cost $0.</Empty>}
        {rows.map((r) => (
          <div key={`${r.provider}|${r.model}`} className="card">
            <div className="title">{r.provider} / {r.model}</div>
            <div className="sub" style={{ whiteSpace: 'normal' }}>
              {r.calls} calls · ↑{fmtTokens(r.prompt)} ↓{fmtTokens(r.completion)} · {fmtMs(r.ms)} · {fmtCost(costUSD(r.model, r.prompt, r.completion))}
            </div>
          </div>
        ))}
        <div style={{ color: 'var(--dim)', fontSize: 11 }}>Costs are estimates from Oct 2026 list prices. `—` = unknown model price. OpenCode runs meter time only.</div>
      </div>
    </div>
  );
}
