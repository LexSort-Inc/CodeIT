// Per-1M-token prices in USD, checked Oct 2026. Estimates — providers change these.
// Key: exact model id. Local engines cost $0 (own hardware).
const PRICES = {
  // Groq list prices (free tier keys still meter at list price for display)
  'openai/gpt-oss-20b': { in: 0.075, out: 0.3 },
  'openai/gpt-oss-120b': { in: 0.15, out: 0.6 },
  // DeepSeek (direct)
  'deepseek-chat': { in: 0.27, out: 1.1 },
  // Google
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  // Anthropic (Oct 2026 lineup; Haiku alias claude-haiku-4-5 resolves to -20251001)
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  // OpenRouter free models (all $0; roster turns over monthly — see openrouter.ai/models)
  'openrouter/free': { in: 0, out: 0 },
  'cohere/north-mini-code:free': { in: 0, out: 0 },
  'google/gemma-4-26b-a4b-it:free': { in: 0, out: 0 },
};

export function costUSD(model, promptTokens, completionTokens) {
  const p = PRICES[String(model || '')];
  if (!p) return null; // unknown — display as —
  return ((promptTokens || 0) * p.in + (completionTokens || 0) * p.out) / 1e6;
}

export function fmtCost(usd) {
  if (usd == null) return '—';
  if (usd === 0) return '$0';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtMs(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
