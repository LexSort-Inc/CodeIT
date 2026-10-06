// Engine smoke tests: pure logic that must survive the rebuild untouched.
// Run: npm run test:smoke (node --experimental-detect-module).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { costUSD, fmtCost, fmtTokens, fmtMs } = await import('../../src/llm/pricing.js');
const { canonProvider, providerLabel, PROVIDERS } = await import('../../src/llm/router.js');
const { modelFacts, splitReady, isDead, markDead, clearDead, isDeadFailure, isTempDeadFailure, isErrorBubble, KEY_LINKS } = await import('../../src/llm/models.js');
const { buildSystemPrompt, matchSkills } = await import('../../src/projects/context.js');
const { containedIn, validChatId, safeExternalUrl, validToolId, validToolKey, validScope, validKeyName, findOnPath, resolveBin } = await import('../../electron/safety.js');
const uiStore = await import('../../src/llm/store.js');

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error(`FAIL: ${name}`); }
}

// pricing
ok(costUSD('openai/gpt-oss-20b', 1e6, 0) === 0.075, 'pricing groq 20b input');
ok(costUSD('nope', 100, 100) === null, 'pricing unknown -> null');
ok(fmtCost(null) === '—', 'fmtCost null');
ok(fmtCost(0) === '$0', 'fmtCost zero');
ok(fmtTokens(1500) === '1.5k', 'fmtTokens k');
ok(fmtMs(1500) === '1.5s', 'fmtMs s');

// providers
ok(canonProvider('anthropic') === 'anthropic', 'canon id');
ok(canonProvider('Claude (Anthropic)') === 'anthropic', 'canon label');
ok(canonProvider('GROQ') === 'groq', 'canon case');
ok(canonProvider('mystery') === 'mystery', 'canon passthrough');
ok(providerLabel('deepseek').includes('DeepSeek'), 'label lookup');
ok(PROVIDERS.some((p) => p.id === 'groq' && p.models[0] === 'openai/gpt-oss-20b'), 'groq default is live id');

// model facts / tiers
ok(modelFacts('ollama', 'qwen3:8b').tier === 'local', 'ollama tier');
ok(modelFacts('groq', 'openai/gpt-oss-20b').tier === 'free', 'groq tier');
ok(modelFacts('deepseek', 'deepseek-chat').tier === 'paid', 'deepseek tier');
ok(modelFacts('openrouter', 'meta-llama/llama-3.3-70b-instruct:free').tier === 'free', 'openrouter free suffix');
ok(modelFacts('openrouter', 'perceptron/perceptron-mk1').tier === 'paid', 'openrouter other paid');
ok(modelFacts('anthropic', 'claude-sonnet-4-6').needsKey, 'anthropic needs key');
ok(!modelFacts('ollama', 'qwen3:8b').needsKey, 'ollama needs no key');
function row(pid, mid) {
  return { ...modelFacts(pid, mid), provider: pid, model: mid };
}
const groups = splitReady(
  [row('ollama', 'qwen3:8b'), row('groq', 'openai/gpt-oss-20b'), row('anthropic', 'claude-sonnet-4-6')],
  { groq: 'k' },
  new Set(['groq/openai/gpt-oss-20b']),
);
ok(groups.working.length === 1 && groups.ready.length === 0 && groups.needsKey.length === 1 && groups.local.length === 1, 'splitReady 4-way');
ok(row('groq', 'openai/gpt-oss-20b').provider === 'groq', 'facts keep caller ids');

// dead list
ok(!isDead('groq', 'openai/gpt-oss-20b'), 'not dead initially');
markDead('groq', 'dead-model', '404');
ok(isDead('groq', 'dead-model'), 'dead sticks');
markDead('gemini', 'quota-model', '429', 60 * 60 * 1000);
ok(isDead('gemini', 'quota-model'), 'temp dead sticks');
ok(isDeadFailure('model_not_found yo'), 'dead failure class');
ok(!isDeadFailure('429 quota exceeded'), 'quota not permanent');
ok(isTempDeadFailure('429 quota exceeded'), 'temp failure class');
ok(!isTempDeadFailure('Missing groq key'), 'NO_KEY never marks');
ok(isErrorBubble('Missing Groq key — add it in Keys'), 'error bubble NO_KEY');
ok(isErrorBubble('gemini 429: {"error"'), 'error bubble http');
ok(!isErrorBubble('Hello world'), 'normal text not bubble');

// keys links
for (const id of ['gemini', 'groq', 'deepseek', 'openrouter', 'anthropic', 'brave']) {
  ok(KEY_LINKS[id]?.url?.startsWith('https://'), `key link ${id}`);
}

// context
const sys = buildSystemPrompt({ notes: 'n', pinsText: '', skills: [], identity: 'm (via p inside CodeIT)' });
ok(sys.includes('m (via p inside CodeIT)'), 'identity in system prompt');
ok(sys.includes('exactly that identity'), 'identity instruction');
const sysDefault = buildSystemPrompt({ notes: '', pinsText: '', skills: [] });
ok(sysDefault.includes('an AI coding assistant'), 'default identity fallback');
ok(matchSkills([{ name: 'Commit Helper', description: 'writes commits', id: 'a', triggers: ['commit'] }], 'please commit this', new Set(['a'])).length === 1, 'skill match');

// safety: IPC boundary helpers (electron/safety.js)
ok(containedIn('/a/b', 'c'), 'contained: plain child');
ok(containedIn('/a/b', '/a/b/c'), 'contained: absolute child inside');
ok(containedIn('/a/b', '.'), 'root itself allowed');
ok(!containedIn('/a/b', '../c'), 'blocked: parent traversal');
ok(!containedIn('/a/b', 'c/../../d'), 'blocked: traversal after child');
ok(!containedIn('/a/b', '/a/c'), 'blocked: absolute outside');
ok(!containedIn('/a/b', ''), 'blocked: empty path');
ok(!containedIn('', 'x'), 'blocked: empty root');
ok(!containedIn(null, 'x'), 'blocked: null root');
ok(containedIn('/a/b', 'sub\\dir'), 'contained: backslash child');

ok(validChatId('p_abc-123_X9'), 'chat id ok');
ok(!validChatId('../evil'), 'chat id traversal blocked');
ok(!validChatId('a/b'), 'chat id separator blocked');
ok(!validChatId('a'.repeat(65)), 'chat id too long');
ok(!validChatId(''), 'chat id empty');
ok(!validChatId('__proto__'), 'chat id proto blocked');
ok(!validChatId(42), 'chat id non-string blocked');

ok(safeExternalUrl('https://example.com/a') === 'https://example.com/a', 'https allowed');
ok(safeExternalUrl('http://localhost:3000') !== null, 'http allowed');
ok(safeExternalUrl('file:///C:/Windows/System32/cmd.exe') === null, 'file: blocked');
ok(safeExternalUrl('javascript:alert(1)') === null, 'javascript: blocked');
ok(safeExternalUrl('smb://host/share') === null, 'smb: blocked');
ok(safeExternalUrl('ms-settings:display') === null, 'ms-settings: blocked');
ok(safeExternalUrl('not a url') === null, 'garbage blocked');
ok(safeExternalUrl('') === null, 'empty url blocked');

ok(validToolId('mcp:memory'), 'tool id ok');
ok(validToolId('skill:commit-helper'), 'tool id skill ok');
ok(!validToolId('__proto__'), 'tool id proto blocked');
ok(!validToolId('MCP:Memory'), 'tool id must be lowercase');
ok(!validToolId('a'.repeat(65)), 'tool id too long');
ok(!validToolId('has space'), 'tool id space blocked');

ok(validToolKey('mcp:memory.read_file'), 'tool key ok');
ok(validToolKey('mcp:context7.resolve-library-id'), 'tool key dashes ok');
ok(!validToolKey('__proto__'), 'tool key proto blocked');
ok(!validToolKey('.leading-dot'), 'tool key leading dot blocked');
ok(!validToolKey(''), 'tool key empty blocked');

const knownProjects = new Set(['p_x1', 'p_y2']);
ok(validScope('global', knownProjects), 'scope global');
ok(validScope(null, knownProjects), 'scope null');
ok(validScope(undefined, knownProjects), 'scope undefined');
ok(validScope('p_x1', knownProjects), 'scope known project');
ok(!validScope('p_unknown', knownProjects), 'scope unknown project blocked');
ok(!validScope('__proto__', knownProjects), 'scope proto blocked');
ok(!validScope('a/b', knownProjects), 'scope separator blocked');
ok(validScope('p_z9', null), 'scope unchecked mode for non-project ids');

ok(validKeyName('groq'), 'key name groq');
ok(validKeyName('openrouter'), 'key name openrouter');
ok(!validKeyName('Groq'), 'key name must be lowercase');
ok(!validKeyName('__proto__'), 'key name proto blocked');
ok(!validKeyName('a'.repeat(33)), 'key name too long');
ok(!validKeyName('bad name'), 'key name space blocked');

ok(findOnPath('definitely-not-a-real-binary-xyz.exe') === null, 'findOnPath missing binary -> null');
if (process.platform === 'win32') {
  const rb = resolveBin('opencode');
  ok(typeof rb === 'string' && !rb.toLowerCase().endsWith('.cmd'), `resolveBin never returns a .cmd shim (${rb})`);
  ok(!rb.toLowerCase().endsWith('opencode.cmd'), 'resolveBin opencode not the cmd shim');
} else {
  ok(resolveBin('opencode') === 'opencode', 'resolveBin passthrough off windows');
}

// store: unified defaults + UI persistence (src/llm/store.js)
localStorage.removeItem('codeit.defaults');
clearDead();
ok(uiStore.loadDefaults().provider === 'groq' && uiStore.loadDefaults().model === 'openai/gpt-oss-20b', 'store factory defaults');
uiStore.saveDefaults('gemini', 'gemini-3.8-flash');
ok(uiStore.loadDefaults().provider === 'gemini', 'store saves + loads defaults');
uiStore.saveDefaults('ghost-provider', 'whatever');
ok(uiStore.loadDefaults().provider === 'groq', 'store rejects unknown provider -> factory');
uiStore.saveDefaults('gemini', 'gemini-3.8-flash');
markDead('gemini', 'gemini-3.8-flash', '404');
ok(uiStore.loadDefaults().provider === 'groq', 'store rejects dead default -> factory');
const groq = PROVIDERS.find((p) => p.id === 'groq');
ok(groq.models.length > 1, 'groq has a second model to fall back to');
ok(uiStore.defaultModelFor('nope') === 'openai/gpt-oss-20b', 'defaultModelFor unknown provider -> factory model');
markDead('groq', groq.models[0], '404');
ok(uiStore.defaultModelFor('groq') === groq.models.find((m) => m !== groq.models[0]), 'defaultModelFor skips dead');
const sel = uiStore.modelsForSelect('groq', groq.models[0]);
ok(sel.includes(groq.models[0]), 'modelsForSelect keeps current selection visible');
ok(sel.includes(groq.models[1]), 'modelsForSelect lists live models');
ok(uiStore.uiGet('nope', 'fb') === 'fb', 'uiGet fallback');
uiStore.uiSet('rightTab', 'tasks');
ok(uiStore.uiGet('rightTab', null) === 'tasks', 'uiSet/uiGet roundtrip');
clearDead();
localStorage.removeItem('codeit.defaults');

console.log(`\nsmoke: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
