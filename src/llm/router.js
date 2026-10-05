// Unified provider router — OpenAI-chat shaped, Ollama-first.
// Inspired by AnythingLLM server providers (MIT) + Jan engine config. No keys committed.

const OLLAMA_HOST = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OLLAMA_HOST) || 'http://127.0.0.1:11434';

export const PROVIDERS = [
  { id: 'ollama', label: 'Ollama (local)', models: ['qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'llama3.2:3b', 'qwen3:8b', 'mistral:7b-instruct-v0.3-q4_0'] },
  { id: 'gemini', label: 'Gemini (free tier)', models: ['gemini-2.0-flash', 'gemini-1.5-flash'] },
  { id: 'groq', label: 'Groq (free tier)', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  { id: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'openrouter', label: 'OpenRouter (free models)', models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-2-9b-it:free'] }
];

export function getKeys() {
  // Keys live in localStorage (v0.1). v0.2: electron safeStorage/keytar.
  return {
    gemini: localStorage.getItem('codeit.gemini') || '',
    groq: localStorage.getItem('codeit.groq') || '',
    deepseek: localStorage.getItem('codeit.deepseek') || '',
    openrouter: localStorage.getItem('codeit.openrouter') || ''
  };
}

export function setKey(provider, value) {
  localStorage.setItem(`codeit.${provider}`, value);
}

async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const line of parts) yield line;
  }
}

// Stream chat; onChunk(token). Throws with .code = 'NO_KEY' | HTTP error.
export async function streamChat({ provider, model, messages, onChunk }) {
  if (provider === 'ollama') {
    const res = await fetch(`${OLLAMA_HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true })
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: is 'ollama serve' running?`);
    for await (const line of sseLines(res)) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') break;
      try {
        const tok = JSON.parse(data)?.choices?.[0]?.delta?.content || '';
        if (tok) onChunk(tok);
      } catch { /* keep-alive */ }
    }
    return;
  }

  const keys = getKeys();
  const key = keys[provider];
  if (!key) {
    const e = new Error(`Missing ${provider} key — add it in Settings (free tier key) or switch to Ollama.`);
    e.code = 'NO_KEY';
    throw e;
  }

  const conf = {
    gemini: { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`, map: toGemini, parse: parseGemini },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', map: (m) => ({ model, messages: m, stream: true }), parse: parseOpenAI },
    deepseek: { url: 'https://api.deepseek.com/chat/completions', map: (m) => ({ model, messages: m, stream: true }), parse: parseOpenAI },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', map: (m) => ({ model, messages: m, stream: true }), parse: parseOpenAI }
  }[provider];

  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'groq' || provider === 'deepseek') headers.Authorization = `Bearer ${key}`;
  if (provider === 'openrouter') { headers.Authorization = `Bearer ${key}`; headers['HTTP-Referer'] = 'https://github.com/JustMeMedia/CodeIT'; }

  const res = await fetch(conf.url, { method: 'POST', headers, body: JSON.stringify(conf.map(messages)) });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  await conf.parse(res, onChunk);
}

function toGemini(messages) {
  return { contents: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), systemInstruction: messages.find((m) => m.role === 'system') ? { parts: [{ text: messages.find((m) => m.role === 'system').content }] } : undefined };
}
async function parseGemini(res, onChunk) {
  for await (const line of sseLines(res)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    try {
      const tok = JSON.parse(t.slice(5))?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (tok) onChunk(tok);
    } catch { /* keep-alive */ }
  }
}
async function parseOpenAI(res, onChunk) {
  for await (const line of sseLines(res)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const data = t.slice(5).trim();
    if (data === '[DONE]') break;
    try {
      const tok = JSON.parse(data)?.choices?.[0]?.delta?.content || '';
      if (tok) onChunk(tok);
    } catch { /* keep-alive */ }
  }
}
