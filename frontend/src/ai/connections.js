import { listModels, NETWORK_MESSAGE } from './providers.js';
// Keys stay in this browser and are sent only to their provider in headers.

export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', product: 'Claude', keysUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI', product: 'ChatGPT models', keysUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  { id: 'gemini', name: 'Google Gemini', product: 'Gemini', keysUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…' },
  { id: 'openrouter', name: 'OpenRouter', product: 'many models', keysUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-…' },
];

export const providerName = (id) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/**
 * @typedef {{ id: string, label: string }} Model
 * @typedef {{ key: string, model: string, models: Model[], checkedAt: number }} Connection
 * @typedef {{ active: string | null, connections: Record<string, Connection> }} Connections
 */

/** @type {Connections} */
export const EMPTY = { active: null, connections: {} };

/** Older or partial stored values become a valid state. */
export function normalize(stored) {
  const connections = {};
  for (const p of PROVIDERS) {
    const c = stored?.connections?.[p.id];
    if (c && typeof c.key === 'string' && c.key && typeof c.model === 'string') {
      connections[p.id] = { key: c.key, model: c.model, models: Array.isArray(c.models) ? c.models : [], checkedAt: c.checkedAt ?? 0 };
    }
  }
  const active = stored?.active in connections ? stored.active : (Object.keys(connections)[0] ?? null);
  return { active, connections };
}

/** Check the user's key directly with their provider. */
export async function checkKey(provider, key, { fetchImpl } = {}) {
  try { return await listModels(provider, key, fetchImpl); }
  catch { return { ok: false, error: 'unavailable', message: NETWORK_MESSAGE }; }
}

/** Add or replace a connection; the first one becomes active. */
export function connect(state, provider, key, { models, defaultModel }, now = Date.now()) {
  const previous = state.connections[provider];
  const keep = previous && models.some((m) => m.id === previous.model) ? previous.model : null;
  return {
    active: state.active ?? provider,
    connections: { ...state.connections, [provider]: { key: key.trim(), model: keep ?? defaultModel, models, checkedAt: now } },
  };
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

/** What AI actions use: provider, model, key, and display labels. */
export function activeConnection(state) {
  const c = state.active && state.connections[state.active];
  if (!c) return null;
  const label = c.models.find((m) => m.id === c.model)?.label ?? c.model;
  return { provider: state.active, model: c.model, key: c.key, label, providerLabel: providerName(state.active) };
}
