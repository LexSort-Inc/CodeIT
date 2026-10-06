import { PROVIDERS } from './router.js';

// Key signup pages (open in system browser). Free-tier unless noted.
export const KEY_LINKS = {
  gemini: { url: 'https://aistudio.google.com/app/apikey', note: 'Free tier' },
  groq: { url: 'https://console.groq.com/keys', note: 'Free tier' },
  deepseek: { url: 'https://platform.deepseek.com/api_keys', note: 'Paid, cheap' },
  openrouter: { url: 'https://openrouter.ai/keys', note: 'Free models' },
  anthropic: { url: 'https://console.anthropic.com/settings/keys', note: 'Paid' },
  brave: { url: 'https://api-dashboard.search.brave.com/register', note: 'Search API' },
};

// Per-model display facts. Context in tokens; null = varies (agent default).
const META = {
  'qwen2.5-coder:7b': { context: 32768 },
  'qwen2.5-coder:14b': { context: 32768 },
  'llama3.2:3b': { context: 131072 },
  'qwen3:8b': { context: 32768, reasoning: true },
  'mistral:7b-instruct-v0.3-q4_0': { context: 32768 },
  'gemini-2.0-flash': { context: 1048576 },
  'gemini-1.5-flash': { context: 1048576 },
  'openai/gpt-oss-20b': { context: 131072 },
  'openai/gpt-oss-120b': { context: 131072 },
  'llama-3.1-8b-instant': { context: 131072 },
  'deepseek-chat': { context: 65536 },
  'deepseek-coder': { context: 65536 },
  'meta-llama/llama-3.3-70b-instruct:free': { context: 131072, free: true },
  'google/gemma-2-9b-it:free': { context: 8192, free: true },
  'claude-sonnet-4-6': { context: 200000 },
  'claude-opus-4-6': { context: 200000, reasoning: true },
  'claude-haiku-4-5': { context: 200000 },
  default: { context: null },
};

export function modelFacts(providerId, model) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  const m = META[String(model)] || {};
  return {
    provider: p ? p.label : providerId,
    model,
    context: m.context ?? null,
    reasoning: !!m.reasoning,
    free: !!m.free || providerId === 'ollama',
    local: providerId === 'ollama',
    tools: p ? !!p.supportsTools : false,
    needsKey: providerId !== 'ollama' && providerId !== 'opencode',
  };
}

// Flat searchable list for the picker, provider order preserved.
export function allModels() {
  const out = [];
  for (const p of PROVIDERS) {
    if (p.id === 'opencode') {
      out.push({ provider: p.id, model: 'default', ...modelFacts(p.id, 'default'), agent: true });
      continue;
    }
    for (const m of p.models) out.push({ provider: p.id, model: m, ...modelFacts(p.id, m) });
  }
  return out;
}

export function fmtContext(n) {
  if (n == null) return 'varies';
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}
