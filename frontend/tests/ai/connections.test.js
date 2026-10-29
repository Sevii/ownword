import { describe, it, expect } from 'vitest';
import * as c from '../../src/ai/connections.js';

const models = [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }];

function fetchReturning(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, calls };
}

describe('AI connections', () => {
  it('checks a key by listing models, sending the key only in the header', async () => {
    const f = fetchReturning(200, { data: models.map(m => ({id:m.id,display_name:m.label})) });
    const r = await c.checkKey('anthropic', '  sk-ant-test  ', { fetchImpl: f.impl });
    expect(r).toEqual({ ok: true, models, defaultModel: 'claude-opus-5-5' });
    expect(f.calls[0].url).toBe('https://api.anthropic.com/v1/models?limit=100');
    expect(f.calls[0].url).not.toContain('sk-ant');
    expect(f.calls[0].init.headers['x-api-key']).toBe('sk-ant-test');
  });

  it('reports a provider error for a rejected key, and an empty model list as unusable', async () => {
    const bad = fetchReturning(401, { error: 'invalid-key' });
    expect(await c.checkKey('anthropic', 'x', { fetchImpl: bad.impl })).toMatchObject({ ok: false, error: 'invalid-key' });
    const empty = fetchReturning(200, { models: [] });
    expect(await c.checkKey('openai', 'x', { fetchImpl: empty.impl })).toMatchObject({ ok: false, error: 'unsupported' });
    const offline = { impl: async () => { throw new TypeError('offline'); } };
    expect(await c.checkKey('openai', 'x', { fetchImpl: offline.impl })).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('connects, keeps a chosen model on reconnect, switches and removes the active connection', () => {
    let s = c.connect(c.EMPTY, 'anthropic', ' k1 ', { models, defaultModel: 'claude-opus-5-5' }, 1);
    expect(s.active).toBe('anthropic');
    expect(s.connections.anthropic).toEqual({ key: 'k1', model: 'claude-opus-5-5', models, checkedAt: 1, remember: true });
    s = c.setModel(s, 'anthropic', 'claude-haiku-5-5');
    s = c.connect(s, 'anthropic', 'k2', { models, defaultModel: 'claude-opus-5-5' }, 2);
    expect(s.connections.anthropic.model).toBe('claude-haiku-5-5');

    s = c.connect(s, 'gemini', 'g', { models: [{ id: 'gemini-flash-latest', label: 'Flash' }], defaultModel: 'gemini-flash-latest' });
    expect(s.active).toBe('anthropic');
    s = c.setActive(s, 'gemini');
    expect(c.activeConnection(s)).toMatchObject({ provider: 'gemini', model: 'gemini-flash-latest', key: 'g', label: 'Flash', providerLabel: 'Google Gemini' });
    s = c.remove(s, 'gemini');
    expect(s.active).toBe('anthropic');
    s = c.remove(s, 'anthropic');
    expect(c.activeConnection(s)).toBeNull();
  });

  it('normalizes stored data, dropping unknown providers and incomplete entries', () => {
    const s = c.normalize({
      active: 'nope',
      connections: { openai: { key: 'k', model: 'gpt-x', models: [] }, evil: { key: 'k', model: 'm' }, gemini: { key: '' } },
    });
    expect(Object.keys(s.connections)).toEqual(['openai']);
    expect(s.active).toBe('openai');
    expect(c.normalize(null)).toEqual(c.EMPTY);
  });
});


describe('direct model discovery', () => {
  it('validates OpenRouter keys before fetching its public catalog', async () => {
    const urls=[];
    const result=await c.checkKey('openrouter','bad',{fetchImpl:async url=>{
      urls.push(url); return new Response('{}',{status:401});
    }});
    expect(result).toMatchObject({ok:false,error:'invalid-key'});
    expect(urls).toEqual(['https://openrouter.ai/api/v1/key']);
  });
  it('paginates Gemini and excludes models that cannot generate text',async()=>{
    const urls=[];
    const result=await c.checkKey('gemini','key',{fetchImpl:async url=>{
      urls.push(url);
      return new Response(JSON.stringify(urls.length===1 ? {models:[{name:'models/embedding',supportedGenerationMethods:['embedContent']}],nextPageToken:'next'} : {models:[{name:'models/gemini-test',displayName:'Test',supportedGenerationMethods:['generateContent']}]}));
    }});
    expect(urls[1]).toContain('pageToken=next');
    expect(result).toMatchObject({ok:true,models:[{id:'gemini-test',label:'Test'}]});
  });
});

describe('custom OpenAI-compatible endpoints (plan §2.1)', async () => {
  const { validateBaseUrl } = await import('../../src/ai/providers.js');

  it('accepts HTTPS anywhere and HTTP only on loopback, and strips trailing slashes', () => {
    expect(validateBaseUrl('https://api.groq.com/openai/v1/')).toBe('https://api.groq.com/openai/v1');
    expect(validateBaseUrl(' http://localhost:11434/v1 ')).toBe('http://localhost:11434/v1');
    expect(validateBaseUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    expect(() => validateBaseUrl('http://example.com/v1')).toThrow(/https/u);
    expect(() => validateBaseUrl('https://user:pw@example.com/v1')).toThrow(/credentials/u);
    expect(() => validateBaseUrl('https://example.com/v1?x=1')).toThrow(/query/u);
    expect(() => validateBaseUrl('localhost:11434')).toThrow(/full endpoint URL/u);
    expect(() => validateBaseUrl('')).toThrow();
  });

  it('lists models from the endpoint, sending no authorization header when a local server has no key', async () => {
    const f = fetchReturning(200, { object: 'list', data: [{ id: 'llama3.2:3b', object: 'model' }, { id: 'qwen2.5:7b', object: 'model' }] });
    const r = await c.checkKey('custom', '', { fetchImpl: f.impl, baseUrl: 'http://localhost:11434/v1/' });
    expect(r).toEqual({ ok: true, models: [{ id: 'llama3.2:3b', label: 'llama3.2:3b' }, { id: 'qwen2.5:7b', label: 'qwen2.5:7b' }], defaultModel: 'llama3.2:3b' });
    expect(f.calls[0].url).toBe('http://localhost:11434/v1/models');
    expect(f.calls[0].init.headers.authorization).toBeUndefined();
  });

  it('requires a key for a remote endpoint and sends it as a bearer token', async () => {
    const f = fetchReturning(200, { data: [{ id: 'm' }] });
    expect(await c.checkKey('custom', '', { fetchImpl: f.impl, baseUrl: 'https://api.groq.com/openai/v1' })).toMatchObject({ ok: false, message: /API key/u });
    await c.checkKey('custom', 'gsk-1', { fetchImpl: f.impl, baseUrl: 'https://api.groq.com/openai/v1' });
    expect(f.calls[0].init.headers.authorization).toBe('Bearer gsk-1');
    expect(await c.checkKey('custom', 'k', { fetchImpl: f.impl, baseUrl: 'http://example.com/v1' })).toMatchObject({ ok: false, message: /https/u });
  });

  it('explains an empty model list and an unreachable server', async () => {
    const empty = fetchReturning(200, { data: [] });
    expect(await c.checkKey('custom', '', { fetchImpl: empty.impl, baseUrl: 'http://localhost:11434/v1' })).toMatchObject({ ok: false, error: 'unsupported', message: /Pull or load a model/u });
    const offline = { impl: async () => { throw new TypeError('Failed to fetch'); } };
    expect(await c.checkKey('custom', '', { fetchImpl: offline.impl, baseUrl: 'http://localhost:11434/v1' })).toMatchObject({ ok: false, error: 'unavailable', message: /CORS/u });
  });

  it('stores the endpoint with the connection and labels it by host', () => {
    const s = c.connect(c.EMPTY, 'custom', '', { models: [{ id: 'llama3.2:3b', label: 'llama3.2:3b' }], defaultModel: 'llama3.2:3b' }, 1, { baseUrl: 'http://localhost:11434/v1/' });
    expect(s.connections.custom).toMatchObject({ key: '', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:3b', remember: true });
    expect(c.activeConnection(s)).toMatchObject({ provider: 'custom', baseUrl: 'http://localhost:11434/v1', providerLabel: 'localhost:11434 (custom endpoint)' });
    expect(c.normalize(s)).toEqual(s);
    // A stored custom connection with a bad or missing URL, or a remote one without a key, is dropped.
    expect(c.normalize({ connections: { custom: { key: '', model: 'm', baseUrl: 'http://example.com/v1' } } })).toEqual(c.EMPTY);
    expect(c.normalize({ connections: { custom: { key: '', model: 'm' } } })).toEqual(c.EMPTY);
  });
});

describe('session-only keys (plan §2.3)', () => {
  it('keeps a session-only connection in memory but out of storage', () => {
    let s = c.connect(c.EMPTY, 'anthropic', 'k1', { models, defaultModel: 'claude-opus-5-5' }, 1, { remember: false });
    s = c.connect(s, 'openai', 'k2', { models: [{ id: 'gpt-x', label: 'GPT' }], defaultModel: 'gpt-x' }, 2);
    expect(s.active).toBe('anthropic');
    expect(c.activeConnection(s)).toMatchObject({ key: 'k1' });
    const stored = c.forStorage(s);
    expect(Object.keys(stored.connections)).toEqual(['openai']);
    expect(stored.active).toBe('openai');
    expect(JSON.stringify(stored)).not.toContain('k1');
    // Loading what was stored brings back only the remembered connection.
    expect(c.normalize(stored).connections.openai).toMatchObject({ key: 'k2', remember: true });
  });
});
