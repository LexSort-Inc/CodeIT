import { useEffect, useState } from 'react';
import { costUSD, fmtCost, fmtTokens, fmtMs } from '../llm/pricing.js';

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
      <div style={{ padding: 8, borderBottom: '1px solid #30363d', display: 'flex', gap: 6, alignItems: 'center' }}>
        <strong style={{ fontSize: 13 }}>Usage</strong>
        <span style={{ flex: 1 }} />
        <button onClick={refresh} title="Refresh">↻</button>
        <button onClick={reset} title="Clear history">Reset</button>
      </div>
      <div style={{ padding: 8, borderBottom: '1px solid #30363d', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>Calls <strong>{grand.calls}</strong></span>
        <span>In <strong>{fmtTokens(grand.prompt)}</strong></span>
        <span>Out <strong>{fmtTokens(grand.completion)}</strong></span>
        <span>Time <strong>{fmtMs(grand.ms)}</strong></span>
        <span>Est. <strong>{grand.known ? fmtCost(grand.cost) : fmtCost(grand.cost) + '+'}</strong></span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.length === 0 && <div style={{ opacity: 0.6 }}>No calls yet — send a chat to start metering. Local models cost $0.</div>}
        {rows.map((r) => (
          <div key={`${r.provider}|${r.model}`} style={{ border: '1px solid #30363d', borderRadius: 8, padding: '6px 8px', background: '#161b22' }}>
            <div style={{ fontWeight: 600 }}>{r.provider} / {r.model}</div>
            <div style={{ opacity: 0.8, marginTop: 2 }}>
              {r.calls} calls · ↑{fmtTokens(r.prompt)} ↓{fmtTokens(r.completion)} · {fmtMs(r.ms)} · {fmtCost(costUSD(r.model, r.prompt, r.completion))}
            </div>
          </div>
        ))}
        <div style={{ opacity: 0.55, fontSize: 11 }}>Costs are estimates from Oct 2026 list prices. `—` = unknown model price. OpenCode runs meter time only.</div>
      </div>
    </div>
  );
}
