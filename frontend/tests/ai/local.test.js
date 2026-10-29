import { describe, it, expect } from 'vitest';
import { createLocalProvider, LOCAL_MODELS, LOCAL_ORIGIN } from '../../src/ai/local.js';
import { runAiRequest } from '../../src/ai/client.js';
import { parseModelJson } from '../../src/ai/validate.js';
import * as c from '../../src/ai/connections.js';

/** A fake WebLLM engine that streams the given text in pieces. */
function fakeEngine(text, { delay = 0 } = {}) {
  const calls = [];
  return {
    calls,
    unloaded: 0,
    interrupted: 0,
    async unload() { this.unloaded++; },
    async interruptGenerate() { this.interrupted++; },
    chat: {
      completions: {
        create: async (req) => {
          calls.push(req);
          const pieces = text.match(/.{1,3}/gsu) ?? [];
          return (async function* () {
            for (const [i, p] of pieces.entries()) {
              if (delay) await new Promise((r) => setTimeout(r, delay));
              yield { choices: [{ delta: { content: p }, finish_reason: i === pieces.length - 1 ? 'stop' : null }] };
            }
          })();
        },
      },
    },
  };
}

const body = { clientRequestId: 'local-test', provider: 'local', model: LOCAL_MODELS[0].id, action: 'explain', blocks: [{ id: 'b', type: 'paragraph', text: 'Teh cat.' }], editableBlockIds: ['b'], instruction: 'What is wrong?' };

describe('in-browser model provider (plan §2.2)', () => {
  it('loads a model once with progress, and streams its answer as SSE the client understands', async () => {
    const engine = fakeEngine('Teh should be The.');
    let created = 0;
    const provider = createLocalProvider({ createEngine: async (id, onProgress) => { created++; onProgress({ progress: 0.5, text: `Fetching ${id}` }); return engine; } });
    const seen = [];
    await provider.load(LOCAL_MODELS[0].id, (p) => seen.push(p));
    expect(seen.map((p) => p.text)).toEqual(['Starting…', `Fetching ${LOCAL_MODELS[0].id}`, 'Ready']);
    expect(provider.loadedModel).toBe(LOCAL_MODELS[0].id);

    const events = [];
    const r = await runAiRequest(body, { key: '', fetchImpl: provider.fetch, onEvent: (e) => events.push(e.type) });
    expect(r.terminal).toMatchObject({ type: 'completed', text: 'Teh should be The.' });
    expect(events[0]).toBe('started');
    expect(created).toBe(1);
    expect(engine.calls[0].messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(engine.calls[0].messages[1].content).toContain('Teh cat.');
  });

  it('is the default transport for the local provider, so no network fetch is attempted', async () => {
    // Without a model loaded, the page-level provider would try to import WebLLM; the fake fetch asserts the URL instead.
    const provider = createLocalProvider({ createEngine: async () => fakeEngine('ok') });
    const r = await runAiRequest(body, { key: '', fetchImpl: async (url, init) => { expect(url).toBe(`${LOCAL_ORIGIN}/chat/completions`); expect(init.headers.authorization).toBeUndefined(); return provider.fetch(url, init); } });
    expect(r.terminal.type).toBe('completed');
  });

  it('answers the model listing and shares one load between concurrent callers', async () => {
    let created = 0;
    const provider = createLocalProvider({ createEngine: async () => { created++; await new Promise((r) => setTimeout(r, 10)); return fakeEngine('x'); } });
    const list = await (await provider.fetch(`${LOCAL_ORIGIN}/models`)).json();
    expect(list.data.map((m) => m.id)).toEqual(LOCAL_MODELS.map((m) => m.id));
    await Promise.all([provider.load(LOCAL_MODELS[1].id), provider.load(LOCAL_MODELS[1].id)]);
    expect(created).toBe(1);
    await provider.load(LOCAL_MODELS[0].id);
    expect(created).toBe(2);
  });

  it('stops generating when the request is cancelled', async () => {
    const engine = fakeEngine('a long answer that keeps going and going', { delay: 5 });
    const provider = createLocalProvider({ createEngine: async () => engine });
    const ctl = new AbortController();
    const promise = runAiRequest(body, { key: '', fetchImpl: provider.fetch, signal: ctl.signal, onEvent: (e) => { if (e.type === 'delta') ctl.abort(); } });
    const r = await promise;
    expect(r.terminal.type).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.interrupted).toBeGreaterThan(0);
  });

  it('is a connection with no key that normalizes and labels itself', () => {
    const s = c.connect(c.EMPTY, 'local', '', { models: LOCAL_MODELS.map((m) => ({ id: m.id, label: m.label })), defaultModel: LOCAL_MODELS[0].id }, 1);
    expect(c.activeConnection(s)).toMatchObject({ provider: 'local', key: '', model: LOCAL_MODELS[0].id, providerLabel: 'this browser' });
    expect(c.normalize(c.forStorage(s)).connections.local).toMatchObject({ model: LOCAL_MODELS[0].id });
    expect(c.normalize({ connections: { local: { key: '', model: 'not-a-model' } } })).toEqual(c.EMPTY);
  });
});

describe('model JSON repair for small models', () => {
  it('still parses clean and fenced JSON', () => {
    expect(parseModelJson('{"blocks": []}')).toEqual({ blocks: [] });
    expect(parseModelJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
  it('strips surrounding prose and trailing commas, and nothing else', () => {
    expect(parseModelJson('Here is the result:\n{"blocks": [{"id": "b", "text": "The cat.",},],}\nHope this helps!')).toEqual({ blocks: [{ id: 'b', text: 'The cat.' }] });
    expect(parseModelJson('{"a": 1 "b": 2}')).toBeNull();
    expect(parseModelJson('no json here')).toBeNull();
    expect(parseModelJson('[1, 2]')).toBeNull();
  });
});
