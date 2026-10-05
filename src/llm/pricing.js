// Per-1M-token prices in USD, checked Oct 2026. Estimates — providers change these.
// Key: exact model id. Local engines cost $0 (own hardware).
const PRICES = {
  // Groq (free tier keys still meter at list price for display)
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
  // DeepSeek
  'deepseek-chat': { in: 0.27, out: 1.1 },
  'deepseek-coder': { in: 0.27, out: 1.1 },
  // Google
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
  // Anthropic
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-6': { in: 15, out: 75 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  // OpenRouter free models
  'meta-llama/llama-3.3-70b-instruct:free': { in: 0, out: 0 },
  'google/gemma-2-9b-it:free': { in: 0, out: 0 },
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
