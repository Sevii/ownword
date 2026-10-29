// Fixed provider origins: credentials never go to the app host or an arbitrary
// URL. The one exception is a custom OpenAI-compatible endpoint the user typed
// in Settings (Ollama, LM Studio, vLLM, Groq, a proxy they run), limited to
// HTTPS or a loopback address, and used only for that connection.
export const ORIGINS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
};
export const CUSTOM = 'custom';
export const LOCAL = 'local';
const LOCAL_ORIGIN = 'local://browser';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Normalize and check a user-typed base URL. Returns it without a trailing slash, or throws. */
export function validateBaseUrl(input) {
  let url;
  try { url = new URL(String(input ?? '').trim()); } catch { throw new Error('Enter the full endpoint URL, such as http://localhost:11434/v1.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Enter the full endpoint URL, such as http://localhost:11434/v1.');
  if (url.username || url.password) throw new Error('Do not put credentials in the endpoint URL.');
  if (url.search || url.hash) throw new Error('The endpoint URL cannot have a query string or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new Error('Use an https:// URL, or http:// only for localhost.');
  }
  return url.href.replace(/\/+$/u, '');
}
export function isLoopback(baseUrl) {
  try { return LOOPBACK.has(new URL(baseUrl).hostname); } catch { return false; }
}
/** The origin requests go to: a fixed one, or the validated custom base URL. */
export function originFor(provider, baseUrl) {
  if (provider === CUSTOM) return validateBaseUrl(baseUrl);
  if (provider === LOCAL) return LOCAL_ORIGIN;
  if (!Object.hasOwn(ORIGINS, provider)) throw new Error('Unsupported provider.');
  return ORIGINS[provider];
}
export function providerHeaders(provider, key, baseUrl) {
  const origin = originFor(provider, baseUrl);
  const k = key?.trim() ?? '';
  // A model in this browser needs no key, and a local server (Ollama, LM Studio) usually none.
  if (!k && provider !== LOCAL && !(provider === CUSTOM && isLoopback(origin))) throw new Error('Add your API key in Settings.');
  return {
    'content-type': 'application/json',
    ...(provider === 'anthropic' ? {
      'x-api-key': k, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    } : provider === 'gemini' ? { 'x-goog-api-key': k } : k ? { authorization: `Bearer ${k}` } : {}),
  };
}
export function statusError(status) {
  return status === 401 || status === 403 ? 'invalid-key' : status === 429 ? 'rate-limited' : status === 413 ? 'input-too-large' : status >= 500 ? 'unavailable' : 'bad-request';
}
export function statusMessage(status) {
  if (status === 401 || status === 403) return 'The provider rejected this key or denied access to the model. Check your API key and permissions.';
  if (status === 429) return 'The provider reports a rate or usage limit. Check your account balance or try again later.';
  return `The provider could not complete the request (${status}). Check your model and account settings.`;
}
export const NETWORK_MESSAGE = 'Could not connect directly to the provider. Check your internet connection and whether your browser or provider allows this request.';
export const LOCAL_NETWORK_MESSAGE = 'Could not reach the endpoint. Check that the server is running, that the URL is right, and that it allows requests from this site (CORS).';

export function generationRequest(body, prompt, key, baseUrl) {
  const { provider, model } = body;
  const headers = providerHeaders(provider, key, baseUrl);
  const origin = originFor(provider, baseUrl);
  let path, data;
  if (provider === 'openai') {
    path = '/responses';
    data = { model, instructions: prompt.system, input: prompt.user, stream: true, store: false, max_output_tokens: 16384 };
  } else if (provider === 'anthropic') {
    path = '/messages';
    data = { model, system: prompt.system, messages: [{ role: 'user', content: prompt.user }], max_tokens: 16384, stream: true };
  } else if (provider === 'gemini') {
    path = `/models/${encodeURIComponent(model.replace(/^models\//u, ''))}:streamGenerateContent?alt=sse`;
    data = { systemInstruction: { parts: [{ text: prompt.system }] }, contents: [{ role: 'user', parts: [{ text: prompt.user }] }], generationConfig: { maxOutputTokens: 16384 } };
  } else {
    // OpenRouter and every OpenAI-compatible server.
    path = '/chat/completions';
    data = { model, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], stream: true, max_tokens: 16384 };
  }
  return { url: origin + path, init: { method: 'POST', headers, body: JSON.stringify(data), credentials: 'omit', referrerPolicy: 'no-referrer' } };
}

export async function listModels(provider, key, fetchImpl = fetch, baseUrl) {
  const headers = providerHeaders(provider, key, baseUrl);
  const origin = originFor(provider, baseUrl);
  const init = { headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) };
  // OpenRouter's catalog is public; authenticate separately before accepting a key.
  if (provider === 'openrouter') {
    const auth = await fetchImpl(`${origin}/key`, init);
    if (!auth.ok) return { ok: false, error: statusError(auth.status), message: statusMessage(auth.status) };
  }
  const models = [];
  let cursor = '', pages = 0;
  do {
    const query = provider === 'anthropic' ? `?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}` : provider === 'gemini' ? `?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}` : '';
    const res = await fetchImpl(`${origin}/models${query}`, init);
    if (!res.ok) return { ok: false, error: statusError(res.status), message: statusMessage(res.status) };
    const data = await res.json();
    for (const m of data.data ?? data.models ?? []) {
      const id = m.id ?? m.name?.replace(/^models\//u, '');
      if (typeof id !== 'string') continue;
      if (provider === 'openai' && (!/^(gpt-|chatgpt-|o\d)/u.test(id) || /audio|realtime|transcrib|tts|image|embedding|moderation|search|computer-use/u.test(id))) continue;
      if (provider === 'gemini' && !m.supportedGenerationMethods?.includes('generateContent')) continue;
      if (provider === 'openrouter' && m.architecture?.output_modalities && !m.architecture.output_modalities.includes('text')) continue;
      models.push({ id, label: m.display_name ?? m.displayName ?? m.name ?? id });
    }
    cursor = provider === 'anthropic' && data.has_more ? data.last_id : provider === 'gemini' ? data.nextPageToken : '';
  } while (cursor && ++pages < 20);
  if (!models.length) {
    return provider === CUSTOM || provider === LOCAL
      ? { ok: false, error: 'unsupported', message: 'The endpoint lists no models. Pull or load a model there first.' }
      : { ok: false, error: 'unsupported', message: 'This key has no supported writing models.' };
  }
  return { ok: true, models, defaultModel: models[0].id };
}
