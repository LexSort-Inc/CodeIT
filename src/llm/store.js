// Unified model/UI store — single source of truth for what the app remembers
// across restarts: default provider/model, open tabs, pane state.
// Storage is best-effort (private mode, quota): every failure falls back to
// the same defaults a fresh install would get.
import { PROVIDERS } from './router.js';
import { isDead } from './models.js';

const DEFAULTS_KEY = 'codeit.defaults';
export const FACTORY_DEFAULTS = { provider: 'groq', model: 'openai/gpt-oss-20b' };

// --- small persisted UI state (tabs, panes) ---
export function uiGet(key, fallback) {
  try {
    const raw = localStorage.getItem(`codeit.ui.${key}`);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
export function uiSet(key, value) {
  try { localStorage.setItem(`codeit.ui.${key}`, JSON.stringify(value)); } catch { /* quota */ }
}

// --- default model for new threads ---
export function loadDefaults() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || 'null'); } catch { /* corrupt */ }
  const valid = saved
    && typeof saved.provider === 'string'
    && typeof saved.model === 'string'
    && PROVIDERS.some((p) => p.id === saved.provider)
    && !isDead(saved.provider, saved.model);
  return valid ? { provider: saved.provider, model: saved.model } : { ...FACTORY_DEFAULTS };
}

export function saveDefaults(provider, model) {
  try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify({ provider, model })); } catch { /* quota */ }
}

// First non-dead model for a provider — never hand back an ID we know is broken.
export function defaultModelFor(provider) {
  const p = PROVIDERS.find((x) => x.id === provider);
  if (!p) return FACTORY_DEFAULTS.model;
  return p.models.find((m) => !isDead(provider, m)) || p.models[0];
}

// Provider's model list for selects: dead IDs hidden, current selection always
// included so a controlled <select> never renders blank.
export function modelsForSelect(provider, current) {
  const p = PROVIDERS.find((x) => x.id === provider);
  if (!p) return current ? [current] : [];
  const list = p.models.filter((m) => !isDead(provider, m));
  if (current && !list.includes(current)) list.push(current);
  return list;
}
