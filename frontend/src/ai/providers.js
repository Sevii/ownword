// Fixed provider origins: credentials never go to the app host or an arbitrary URL.
export const ORIGINS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
};
export function providerHeaders(provider, key) {
  if (!Object.hasOwn(ORIGINS, provider)) throw new Error('Unsupported provider.');
  if (!key?.trim()) throw new Error('Add your API key in Settings.');
  return {
    'content-type': 'application/json',
    ...(provider === 'anthropic' ? {
      'x-api-key': key.trim(), 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    } : provider === 'gemini' ? { 'x-goog-api-key': key.trim() } : { authorization: `Bearer ${key.trim()}` }),
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

export function generationRequest(body, prompt, key) {
  const { provider, model } = body;
  const headers = providerHeaders(provider, key);
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
    path = '/chat/completions';
    data = { model, messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }], stream: true, max_tokens: 16384 };
  }
  return { url: ORIGINS[provider] + path, init: { method: 'POST', headers, body: JSON.stringify(data), credentials: 'omit', referrerPolicy: 'no-referrer' } };
}

export async function listModels(provider, key, fetchImpl = fetch) {
  const headers = providerHeaders(provider, key);
  // OpenRouter's catalog is public; authenticate separately before accepting a key.
  if (provider === 'openrouter') {
    const auth = await fetchImpl(`${ORIGINS[provider]}/key`, { headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
    if (!auth.ok) return { ok: false, error: statusError(auth.status), message: statusMessage(auth.status) };
  }
  const models = [];
  let cursor = '', pages = 0;
  do {
    const query = provider === 'anthropic' ? `?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}` : provider === 'gemini' ? `?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}` : '';
    const res = await fetchImpl(`${ORIGINS[provider]}/models${query}`, { headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
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
  if (!models.length) return { ok: false, error: 'unsupported', message: 'This key has no supported writing models.' };
  return { ok: true, models, defaultModel: models[0].id };
}
