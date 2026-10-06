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
const { modelFacts, splitReady, isDead, markDead, isDeadFailure, isTempDeadFailure, isErrorBubble, KEY_LINKS } = await import('../../src/llm/models.js');
const { buildSystemPrompt, matchSkills } = await import('../../src/projects/context.js');

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

console.log(`\nsmoke: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
