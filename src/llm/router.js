// Unified provider router — OpenAI-chat shaped, Ollama-first.
// Inspired by AnythingLLM server providers (MIT) + Jan engine config. No keys committed.

const OLLAMA_HOST = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_OLLAMA_HOST) || 'http://127.0.0.1:11434';

// Canonicalize a provider reference: accepts id or label in any case
// ('anthropic', 'Anthropic', 'Claude (Anthropic)') -> 'anthropic'.
// Threads persisted by older builds may hold labels; key lookup must not miss.
export function canonProvider(p) {
  const s = String(p || '').trim().toLowerCase();
  if (!s) return p;
  const hit = PROVIDERS.find((x) => x.id.toLowerCase() === s || String(x.label || '').toLowerCase() === s);
  return hit ? hit.id : p;
}

export function providerLabel(p) {
  return PROVIDERS.find((x) => x.id === canonProvider(p))?.label || String(p);
}

export const PROVIDERS = [
  { id: 'ollama', label: 'Ollama (local)', supportsTools: true, contextK: 16, models: ['qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'llama3.2:3b', 'qwen3:8b', 'mistral:7b-instruct-v0.3-q4_0'] },
  { id: 'gemini', label: 'Gemini (free tier)', supportsTools: false, contextK: 1000, models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'] },
  { id: 'groq', label: 'Groq (free tier)', supportsTools: true, contextK: 128, models: ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-8b-8192'] },
  { id: 'deepseek', label: 'DeepSeek', supportsTools: true, contextK: 64, models: ['deepseek-chat', 'deepseek-coder'] },
  { id: 'openrouter', label: 'OpenRouter (free models)', supportsTools: true, contextK: 128, models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemma-2-9b-it:free', 'mistralai/mistral-7b-instruct:free'] },
  { id: 'anthropic', label: 'Claude (Anthropic)', supportsTools: true, contextK: 200, models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'] },
  { id: 'opencode', label: 'OpenCode (agent)', supportsTools: true, contextK: 128, models: ['default'] }
];

// Provider + tool keys. Electron: OS keychain via keys:* IPC (safeStorage).
// Browser preview: localStorage fallback. Legacy localStorage keys migrate up on first load.
const LEGACY = ['gemini', 'groq', 'deepseek', 'openrouter', 'brave', 'anthropic'];
let keyCache = null;
export async function getKeys() {
  if (!window.codeit?.keysGet) {
    const out = {};
    for (const k of LEGACY) out[k] = localStorage.getItem(`codeit.${k}`) || '';
    return out;
  }
  if (!keyCache) {
    keyCache = await window.codeit.keysGet();
    // one-time migration of legacy plaintext keys into keychain
    for (const k of LEGACY) {
      const legacy = localStorage.getItem(`codeit.${k}`);
      if (legacy && !keyCache[k]) {
        await window.codeit.keysSet(k, legacy);
        keyCache[k] = legacy;
      }
      if (legacy) localStorage.removeItem(`codeit.${k}`);
    }
  }
  return { ...keyCache };
}

export async function setKey(provider, value) {
  if (window.codeit?.keysSet) {
    await window.codeit.keysSet(provider, value);
    keyCache = { ...(keyCache || {}), [provider]: value };
  } else localStorage.setItem(`codeit.${provider}`, value);
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

// HTTP error with `.status` attached — the dead-model logic in ChatPane gates
// permanent marking on this (404/410 only; never 401/403/5xx).
async function httpErr(provider, res, fallback) {
  let body = '';
  try { body = (await res.text()).slice(0, 300); } catch { /* body gone */ }
  const e = new Error(`${provider} ${res.status}: ${body || fallback}`);
  e.status = res.status;
  return e;
}

// Parse one SSE payload; null on keep-alive/garbage lines.
function sseJson(data) {
  try { return JSON.parse(data); } catch { return null; }
}

// Providers signal fatal errors INSIDE 200-OK streams. Ignoring them made
// failed runs record ok:true and award "verified" checks to broken models.
function frameErr(provider, json) {
  if (!json) return null;
  const err = json.error
    || (json.type === 'error' ? json.error : null)
    || (json.promptFeedback?.blockReason ? { message: `blocked: ${json.promptFeedback.blockReason}` } : null);
  if (!err) return null;
  return new Error(`${provider} stream error: ${typeof err === 'string' ? err : String(err.message || JSON.stringify(err)).slice(0, 300)}`);
}

// Stream chat; onChunk(token), onUsage({prompt, completion}). Throws with .code = 'NO_KEY' | HTTP error.
export async function streamChat({ provider, model, messages, onChunk, onUsage, signal }) {
  provider = canonProvider(provider);
  if (provider === 'ollama') {
    const res = await fetch(`${OLLAMA_HOST}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal
    });
    if (!res.ok) throw await httpErr('Ollama', res, "is 'ollama serve' running?");
    for await (const line of sseLines(res)) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') break;
      const json = sseJson(data);
      if (!json) continue;
      const fe = frameErr('Ollama', json);
      if (fe) throw fe;
      const tok = json?.choices?.[0]?.delta?.content || '';
      if (tok) onChunk(tok);
      if (json?.usage) onUsage?.({ prompt: json.usage.prompt_tokens || 0, completion: json.usage.completion_tokens || 0 });
    }
    return;
  }

  if (provider === 'opencode') {
    const e = new Error('OpenCode runs via the agent runner, not streaming chat — use a thread with the OpenCode engine.');
    e.code = 'OPENCODE_ENGINE';
    throw e;
  }

  const keys = await getKeys();
  const key = keys[provider];
  if (!key) {
    const saved = Object.keys(keys).filter((k) => keys[k]);
    const e = new Error(`Missing ${providerLabel(provider)} key — add it in Keys (saved: ${saved.length ? saved.join(', ') : 'none'}) or switch to a free-tier thread with a saved key.`);
    e.code = 'NO_KEY';
    throw e;
  }

  if (provider === 'anthropic') {
    await streamAnthropic({ model, key, messages, onChunk, onUsage, signal });
    return;
  }

  const conf = {
    gemini: { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`, map: toGemini, parse: parseGemini },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', map: (m) => ({ model, messages: m, stream: true }), parse: parseOpenAI },
    deepseek: { url: 'https://api.deepseek.com/chat/completions', map: (m) => ({ model, messages: m, stream: true }), parse: parseOpenAI },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', map: (m) => ({ model, messages: m, stream: true }), parse: parseOpenAI }
  }[provider];

  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'groq' || provider === 'deepseek') headers.Authorization = `Bearer ${key}`;
  if (provider === 'openrouter') { headers.Authorization = `Bearer ${key}`; headers['HTTP-Referer'] = 'https://codeit.app'; }

  const res = await fetch(conf.url, { method: 'POST', headers, body: JSON.stringify(conf.map(messages)), signal });
  if (!res.ok) throw await httpErr(provider, res, 'request failed');
  await conf.parse(res, onChunk, onUsage, provider);
}

function toGemini(messages) {
  return { contents: messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })), systemInstruction: messages.find((m) => m.role === 'system') ? { parts: [{ text: messages.find((m) => m.role === 'system').content }] } : undefined };
}
async function parseGemini(res, onChunk, onUsage, provider = 'gemini') {
  for await (const line of sseLines(res)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const json = sseJson(t.slice(5));
    if (!json) continue;
    const fe = frameErr(provider, json);
    if (fe) throw fe;
    const tok = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (tok) onChunk(tok);
    if (json?.usageMetadata) onUsage?.({ prompt: json.usageMetadata.promptTokenCount || 0, completion: json.usageMetadata.candidatesTokenCount || 0 });
  }
}
async function streamAnthropic({ model, key, messages, onChunk, onUsage, signal }) {
  const sys = messages.find((m) => m.role === 'system');
  const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system: sys?.content, messages: turns, stream: true })
  });
  if (!res.ok) throw await httpErr('anthropic', res, 'request failed');
  let pin = 0;
  let pout = 0;
  for await (const line of sseLines(res)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const json = sseJson(t.slice(5));
    if (!json) continue;
    const fe = frameErr('anthropic', json);
    if (fe) throw fe;
    const tok = json?.delta?.text || '';
    if (tok) onChunk(tok);
    if (json?.message?.usage) pin += json.message.usage.input_tokens || 0;
    if (json?.usage) pout += json.usage.output_tokens || 0;
  }
  if (pin || pout) onUsage?.({ prompt: pin, completion: pout });
}
async function parseOpenAI(res, onChunk, onUsage, provider = 'openai-compatible') {
  for await (const line of sseLines(res)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const data = t.slice(5).trim();
    if (data === '[DONE]') break;
    const json = sseJson(data);
    if (!json) continue;
    const fe = frameErr(provider, json);
    if (fe) throw fe;
    const tok = json?.choices?.[0]?.delta?.content || '';
    if (tok) onChunk(tok);
    if (json?.usage) onUsage?.({ prompt: json.usage.prompt_tokens || 0, completion: json.usage.completion_tokens || 0 });
  }
}

// ---------- Tool-capable chat (OpenAI-shaped providers: ollama/groq/deepseek/openrouter) ----------
// Collects enabled MCP tools, does one non-streaming pass with `tools`,
// executes calls via onToolCall({serverId,name,args,risk}) -> string,
// then streams the final answer. Max 3 tool rounds. Gemini excluded (different shape).
async function openAiPost({ provider, model, key, body, signal }) {
  const urls = {
    ollama: `${OLLAMA_HOST}/v1/chat/completions`,
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions'
  };
  const headers = { 'Content-Type': 'application/json' };
  if (provider !== 'ollama') headers.Authorization = `Bearer ${key}`;
  if (provider === 'openrouter') headers['HTTP-Referer'] = 'https://codeit.app';
  const res = await fetch(urls[provider], { method: 'POST', headers, body: JSON.stringify({ model, ...body }), signal });
  if (!res.ok) throw await httpErr(provider, res, 'request failed');
  return res;
}

function toOpenAiTools(mcpTools) {
  // mcpTools: [{serverId, name, description, inputSchema, risk}]
  return mcpTools.map((t) => ({
    type: 'function',
    function: { name: `${t.serverId.replace(/^mcp:/, '')}__${t.name}`, description: (t.description || t.name).slice(0, 500), parameters: t.inputSchema || { type: 'object', properties: {} } }
  }));
}

export async function chatWithTools({ provider, model, messages, mcpTools, onChunk, onToolCall, onToolEvent, onUsage, signal }) {
  provider = canonProvider(provider);
  if (typeof onToolCall !== 'function') {
    const e = new Error('chatWithTools requires onToolCall({serverId,name,args}) -> string');
    e.code = 'ENGINE';
    throw e;
  }
  if (provider === 'opencode') {
    const e = new Error('OpenCode runs via the agent runner, not the MCP loop.');
    e.code = 'OPENCODE_ENGINE';
    throw e;
  }
  const keys = await getKeys();
  const key = provider === 'ollama' ? null : keys[provider];
  if (provider !== 'ollama' && !key) {
    const saved = Object.keys(keys).filter((k) => keys[k]);
    const e = new Error(`Missing ${providerLabel(provider)} key — add it in Keys (saved: ${saved.length ? saved.join(', ') : 'none'}) or switch to a free-tier thread with a saved key.`);
    e.code = 'NO_KEY';
    throw e;
  }

  // Anthropic native tool calling
  if (provider === 'anthropic') {
    await chatWithToolsAnthropic({ model, key, messages, mcpTools, onChunk, onToolCall, onToolEvent, onUsage, signal });
    return;
  }

  const tools = toOpenAiTools(mcpTools || []);
  const convo = [...messages];
  const use = (u) => onUsage?.(u);
  for (let round = 0; round < 3; round++) {
    const { msg, calls, usage } = await toolRound({ provider, model, key, convo, tools, signal });
    if (usage) use(usage);
    if (!calls.length) {
      await streamFinal({ provider, model, key, convo, onChunk, onUsage: use, signal });
      return;
    }
    convo.push(msg);
    for (const c of calls) {
      const [serverShort, ...rest] = (c.name || '__').split('__');
      const serverId = `mcp:${serverShort}`;
      onToolEvent?.({ status: 'calling', serverId, name: rest.join('__'), args: c.args });
      let result = '';
      let failed = false;
      try {
        result = await onToolCall({ serverId, name: rest.join('__'), args: c.args });
      } catch (err) {
        result = `Tool error: ${String(err && err.message || err).slice(0, 1000)}`;
        failed = true;
      }
      onToolEvent?.({ status: failed ? 'error' : 'done', serverId, name: rest.join('__') });
      convo.push(provider === 'ollama'
        ? { role: 'tool', content: String(result).slice(0, 8000) }
        : { role: 'tool', tool_call_id: c.id, content: String(result).slice(0, 8000) });
    }
  }
  // rounds exhausted — stream final summary
  convo.push({ role: 'user', content: 'Summarize the tool results above concisely.' });
  await streamFinal({ provider, model, key, convo, onChunk, onUsage: use, signal });
}

// Anthropic tool calling: uses the Anthropic native format (not OpenAI-compat).
async function chatWithToolsAnthropic({ model, key, messages, mcpTools, onChunk, onToolCall, onToolEvent, onUsage, signal }) {
  const sys = messages.find((m) => m.role === 'system');
  const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: m.content }));
  const tools = (mcpTools || []).map((t) => ({
    name: `${t.serverId.replace(/^mcp:/, '')}__${t.name}`,
    description: (t.description || t.name).slice(0, 500),
    input_schema: t.inputSchema || { type: 'object', properties: {} },
  }));
  const convo = [...turns];
  for (let round = 0; round < 3; round++) {
    const body = { model, max_tokens: 4096, messages: convo, stream: false };
    if (sys?.content) body.system = sys.content;
    if (tools.length) body.tools = tools;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await httpErr('anthropic', res, 'request failed');
    const data = await res.json();
    if (data.usage) onUsage?.({ prompt: data.usage.input_tokens || 0, completion: data.usage.output_tokens || 0 });
    const toolBlocks = (data.content || []).filter((b) => b.type === 'tool_use');
    const textBlocks = (data.content || []).filter((b) => b.type === 'text');
    if (!toolBlocks.length) {
      // No tool calls — stream a final pass for nice streaming UX
      const finalText = textBlocks.map((b) => b.text || '').join('');
      if (finalText) onChunk(finalText);
      return;
    }
    // Push assistant turn with all content blocks
    convo.push({ role: 'assistant', content: data.content });
    const toolResults = [];
    for (const tb of toolBlocks) {
      const [serverShort, ...rest] = (tb.name || '__').split('__');
      const serverId = `mcp:${serverShort}`;
      onToolEvent?.({ status: 'calling', serverId, name: rest.join('__'), args: tb.input });
      let result = '';
      let failed = false;
      try {
        result = await onToolCall({ serverId, name: rest.join('__'), args: tb.input || {} });
      } catch (err) {
        result = `Tool error: ${String(err && err.message || err).slice(0, 1000)}`;
        failed = true;
      }
      onToolEvent?.({ status: failed ? 'error' : 'done', serverId, name: rest.join('__') });
      toolResults.push({ type: 'tool_result', tool_use_id: tb.id, content: String(result).slice(0, 8000) });
    }
    convo.push({ role: 'user', content: toolResults });
  }
  // rounds exhausted — stream final summary
  const finalRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system: sys?.content, messages: [...convo, { role: 'user', content: 'Summarize the tool results above concisely.' }], stream: true }),
  });
  if (!finalRes.ok) throw await httpErr('anthropic', finalRes, 'request failed');
  let pin = 0; let pout = 0;
  for await (const line of sseLines(finalRes)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const json = sseJson(t.slice(5));
    if (!json) continue;
    const fe = frameErr('anthropic', json);
    if (fe) throw fe;
    const tok = json?.delta?.text || '';
    if (tok) onChunk(tok);
    if (json?.message?.usage) pin += json.message.usage.input_tokens || 0;
    if (json?.usage) pout += json.usage.output_tokens || 0;
  }
  if (pin || pout) onUsage?.({ prompt: pin, completion: pout });
}

// One non-streaming round: returns {msg, calls:[{id,name,args}], usage:{prompt,completion}}.
async function toolRound({ provider, model, key, convo, tools, signal }) {
  if (provider === 'ollama') {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: convo, tools: tools.length ? tools : undefined, stream: false }),
      signal
    });
    if (!res.ok) throw await httpErr('Ollama', res, "is 'ollama serve' running?");
    const data = await res.json();
    const msg = data?.message || {};
    const calls = (msg.tool_calls || []).map((t, i) => ({
      id: t.id || `call_ollama_${i}`,
      name: t.function?.name || '',
      args: t.function?.arguments && typeof t.function.arguments === 'object' ? t.function.arguments : safeParseArgs(t.function?.arguments)
    })).filter((c) => c.name);
    const usage = (data.prompt_eval_count || data.eval_count)
      ? { prompt: data.prompt_eval_count || 0, completion: data.eval_count || 0 }
      : null;
    return { msg: { role: 'assistant', content: msg.content || '', tool_calls: (msg.tool_calls || []).map((t, i) => ({ id: t.id || `call_ollama_${i}`, type: 'function', function: { name: t.function?.name || '', arguments: JSON.stringify(t.function?.arguments || {}) } })) }, calls, usage };
  }
  const res = await openAiPost({ provider, model, key, body: { messages: convo, tools: tools.length ? tools : undefined, stream: false }, signal });
  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  if (!msg) throw new Error(`${provider}: empty response`);
  const calls = (msg.tool_calls || []).map((c) => ({ id: c.id, name: c.function?.name || '', args: safeParseArgs(c.function?.arguments) })).filter((c) => c.name);
  const usage = data?.usage ? { prompt: data.usage.prompt_tokens || 0, completion: data.usage.completion_tokens || 0 } : null;
  return { msg, calls, usage };
}

function safeParseArgs(a) {
  if (!a) return {};
  if (typeof a === 'object') return a;
  try { return JSON.parse(a); } catch { return {}; }
}

async function streamFinal({ provider, model, key, convo, onChunk, onUsage, signal }) {
  if (provider === 'ollama') {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: convo, stream: true }),
      signal
    });
    if (!res.ok) throw await httpErr('Ollama', res, "is 'ollama serve' running?");
    for await (const line of sseLines(res)) {
      const t = line.trim();
      if (!t) continue;
      const json = sseJson(t);
      if (!json) continue;
      if (json.error) throw new Error(`Ollama stream error: ${String(json.error).slice(0, 300)}`);
      const tok = json?.message?.content || '';
      if (tok) onChunk(tok);
      if (json?.done && (json?.prompt_eval_count || json?.eval_count)) {
        onUsage?.({ prompt: json.prompt_eval_count || 0, completion: json.eval_count || 0 });
      }
    }
    return;
  }
  const res2 = await openAiPost({ provider, model, key, body: { messages: convo, stream: true }, signal });
  await parseOpenAI(res2, onChunk, onUsage, provider);
}

// Key check: minimal live call per provider. Chat providers send 'hi' to the
// first model; Brave runs a count=1 search (costs 1 query). Never throws.
export async function testProviderKey(providerId) {
  const id = canonProvider(providerId);
  try {
    if (id === 'brave') {
      const keys = await getKeys();
      if (!keys.brave) return { ok: false, error: 'No key saved.' };
      const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=ok&count=1', {
        headers: { 'X-Subscription-Token': keys.brave },
      });
      if (!res.ok) return { ok: false, error: `Brave ${res.status}: ${(await res.text()).slice(0, 120)}` };
      return { ok: true, detail: 'Search API answered.' };
    }
    const p = PROVIDERS.find((x) => x.id === id);
    if (!p) return { ok: false, error: `Unknown provider ${id}.` };
    await streamChat({ provider: id, model: p.models[0], messages: [{ role: 'user', content: 'hi' }], onChunk: () => {} });
    return { ok: true, detail: `${p.models[0]} answered.` };
  } catch (err) {
    return { ok: false, error: String(err.message || err).slice(0, 160) };
  }
}

// Live model lists: providers that expose one. Results cached by the picker.
export async function refreshProviderModels(providerId) {
  const id = canonProvider(providerId);
  if (id === 'ollama') {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) throw new Error(`Ollama ${res.status}: is 'ollama serve' running?`);
    const data = await res.json();
    return (data.models || []).map((m) => m.name).filter(Boolean);
  }
  if (id === 'opencode') throw new Error('OpenCode uses its own config — pick models there.');
  if (id === 'anthropic') throw new Error('Anthropic has no list API — see console.anthropic.com for current IDs.');
  const keys = await getKeys();
  const key = keys[id];
  if (!key) { const e = new Error(`Add the ${id} key first.`); e.code = 'NO_KEY'; throw e; }
  const urls = {
    groq: 'https://api.groq.com/openai/v1/models',
    openrouter: 'https://openrouter.ai/api/v1/models',
    deepseek: 'https://api.deepseek.com/v1/models',
    gemini: `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
  };
  const url = urls[id];
  if (!url) throw new Error(`No list endpoint for ${id}.`);
  const headers = {};
  if (id !== 'gemini') headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${id} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (id === 'gemini') return (data.models || []).map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
  return (data.data || []).map((m) => m.id).filter(Boolean);
}

// Models verified (Oct 2026, Ollama native /api/chat) to emit structured tool_calls.
// qwen2.5-coder:7b and llama3.1:8b emit pseudo-call text instead — warn but allow.
export function ollamaToolCapable(model) {
  const m = String(model || '');
  return m.startsWith('qwen3') || m.startsWith('mistral');
}

// Default export surface for renderer: fetch enabled MCP tools as OpenAI functions.
export async function getEnabledMcpTools() {
  if (!window.codeit?.toolsCatalog || !window.codeit?.toolsServerTools) return [];
  const catalog = await window.codeit.toolsCatalog();
  const out = [];
  for (const c of catalog.filter((x) => x.kind === 'mcp' && x.enabled)) {
    try {
      const r = await window.codeit.toolsServerTools(c.id);
      if (r.ok) for (const t of r.tools) out.push({ serverId: c.id, name: t.name, description: t.description, inputSchema: t.inputSchema, risk: c.risk });
    } catch { /* server failed to start (npx offline?) — skip quietly */ }
  }
  return out;
}
