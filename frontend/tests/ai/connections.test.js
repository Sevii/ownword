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
    expect(s.connections.anthropic).toEqual({ key: 'k1', model: 'claude-opus-5-5', models, checkedAt: 1 });
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
