import { listModels, NETWORK_MESSAGE, LOCAL_NETWORK_MESSAGE, CUSTOM, validateBaseUrl, isLoopback } from './providers.js';
// Keys stay in this browser and are sent only to their provider in headers.
// A connection marked remember: false is never written to storage (plan §2.3).

export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', product: 'Claude', keysUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI', product: 'ChatGPT models', keysUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  { id: 'gemini', name: 'Google Gemini', product: 'Gemini', keysUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…' },
  { id: 'openrouter', name: 'OpenRouter', product: 'many models', keysUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-…' },
  { id: CUSTOM, name: 'Custom endpoint', product: 'OpenAI-compatible server: Ollama, LM Studio, vLLM, Groq, …', keysUrl: '', keyHint: 'API key (optional for localhost)', urlHint: 'http://localhost:11434/v1' },
];

export const providerName = (id) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/**
 * @typedef {{ id: string, label: string }} Model
 * @typedef {{ key: string, model: string, models: Model[], checkedAt: number, baseUrl?: string, remember?: boolean }} Connection
 * @typedef {{ active: string | null, connections: Record<string, Connection> }} Connections
 */

/** @type {Connections} */
export const EMPTY = { active: null, connections: {} };

function validCustomUrl(url) {
  try { return validateBaseUrl(url); } catch { return null; }
}

/** Older or partial stored values become a valid state. */
export function normalize(stored) {
  const connections = {};
  for (const p of PROVIDERS) {
    const c = stored?.connections?.[p.id];
    if (!c || typeof c.key !== 'string' || typeof c.model !== 'string') continue;
    const base = { model: c.model, models: Array.isArray(c.models) ? c.models : [], checkedAt: c.checkedAt ?? 0, remember: c.remember !== false };
    if (p.id === CUSTOM) {
      const baseUrl = validCustomUrl(c.baseUrl);
      if (!baseUrl || (!c.key && !isLoopback(baseUrl))) continue;
      connections[p.id] = { key: c.key, baseUrl, ...base };
    } else if (c.key) {
      connections[p.id] = { key: c.key, ...base };
    }
  }
  const active = stored?.active in connections ? stored.active : (Object.keys(connections)[0] ?? null);
  return { active, connections };
}

/** What may be written to disk: session-only connections are left out. */
export function forStorage(state) {
  const connections = Object.fromEntries(Object.entries(state.connections).filter(([, c]) => c.remember !== false));
  const active = state.active in connections ? state.active : (Object.keys(connections)[0] ?? null);
  return { active, connections };
}

/** Check the user's key directly with their provider. */
export async function checkKey(provider, key, { fetchImpl, baseUrl } = {}) {
  try { return await listModels(provider, key, fetchImpl, baseUrl); }
  catch (err) {
    if (provider === CUSTOM && err instanceof Error && !(err instanceof TypeError)) return { ok: false, error: 'bad-request', message: err.message };
    return { ok: false, error: 'unavailable', message: provider === CUSTOM ? LOCAL_NETWORK_MESSAGE : NETWORK_MESSAGE };
  }
}

/** Add or replace a connection; the first one becomes active. */
export function connect(state, provider, key, { models, defaultModel }, now = Date.now(), { baseUrl, remember = true } = {}) {
  const previous = state.connections[provider];
  const keep = previous && models.some((m) => m.id === previous.model) ? previous.model : null;
  const connection = { key: key.trim(), model: keep ?? defaultModel, models, checkedAt: now, remember };
  if (provider === CUSTOM) connection.baseUrl = validateBaseUrl(baseUrl);
  return { active: state.active ?? provider, connections: { ...state.connections, [provider]: connection } };
}

export function remove(state, provider) {
  const { [provider]: _gone, ...rest } = state.connections;
  return { active: state.active === provider ? (Object.keys(rest)[0] ?? null) : state.active, connections: rest };
}

export function setModel(state, provider, model) {
  const c = state.connections[provider];
  if (!c) return state;
  return { ...state, connections: { ...state.connections, [provider]: { ...c, model } } };
}

export function setActive(state, provider) {
  return provider in state.connections ? { ...state, active: provider } : state;
}

/** A short label for where a custom connection goes. */
export function endpointLabel(baseUrl) {
  try { return new URL(baseUrl).host; } catch { return baseUrl; }
}

/** What AI actions use: provider, model, key, and display labels. */
export function activeConnection(state) {
  const c = state.active && state.connections[state.active];
  if (!c) return null;
  const label = c.models.find((m) => m.id === c.model)?.label ?? c.model;
  const providerLabel = state.active === CUSTOM ? `${endpointLabel(c.baseUrl)} (custom endpoint)` : providerName(state.active);
  return { provider: state.active, model: c.model, key: c.key, baseUrl: c.baseUrl, label, providerLabel };
}
