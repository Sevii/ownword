// A model that runs in this browser with WebGPU (WebLLM). Nothing leaves the
// device: the weights are downloaded once from the model host and cached by
// the browser. The engine is exposed as a fetch-like function that answers
// /chat/completions with server-sent events, so client.js streams it exactly
// like a remote OpenAI-compatible server (improvement plan §2.2).

export const LOCAL = 'local';
export const LOCAL_ORIGIN = 'local://browser';

/** Small instruct models that fit most laptops. Sizes are WebLLM's VRAM estimates. */
export const LOCAL_MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B', mb: 1630, note: 'quick, good at short fixes' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', mb: 2264, note: 'better rewrites, needs about 3 GB free' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B', mb: 2505, note: 'strong JSON, needs about 3 GB free' },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', mb: 879, note: 'smallest, for older machines' },
];

export function isSupported() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/** The default engine factory: lazy, so the 1 MB WebLLM chunk loads only when chosen. */
async function loadWebLlm(modelId, onProgress) {
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  return CreateMLCEngine(modelId, { initProgressCallback: (p) => onProgress?.({ progress: p.progress ?? 0, text: p.text ?? '' }) });
}

/**
 * One engine per page, holding at most one model. `createEngine` is injectable
 * for tests and takes (modelId, onProgress) and returns an object with
 * chat.completions.create({ messages, stream: true }) yielding OpenAI chunks.
 */
export function createLocalProvider({ createEngine = loadWebLlm } = {}) {
  let engine = null;
  let loadedModel = '';
  let loading = null;
  let lastProgress = { progress: 0, text: '' };
  const listeners = new Set();

  function notify(p) {
    lastProgress = p;
    for (const l of listeners) l(p);
  }

  async function load(modelId, onProgress) {
    if (engine && loadedModel === modelId) return engine;
    if (loading?.modelId === modelId) {
      if (onProgress) listeners.add(onProgress);
      try { return await loading.promise; } finally { listeners.delete(onProgress); }
    }
    if (onProgress) listeners.add(onProgress);
    const promise = (async () => {
      if (engine) {
        await engine.unload?.();
        engine = null;
        loadedModel = '';
      }
      notify({ progress: 0, text: 'Starting…' });
      const e = await createEngine(modelId, notify);
      engine = e;
      loadedModel = modelId;
      notify({ progress: 1, text: 'Ready' });
      return e;
    })();
    loading = { modelId, promise };
    try {
      return await promise;
    } finally {
      if (loading?.promise === promise) loading = null;
      listeners.delete(onProgress);
    }
  }

  async function unload() {
    if (engine) await engine.unload?.();
    engine = null;
    loadedModel = '';
  }

  /**
   * Answer a /chat/completions request with an SSE stream of OpenAI chunks.
   * The signal aborts generation; a finished stream ends with finish_reason.
   * @param {string} url @param {RequestInit} init
   */
  async function fetchLocal(url, init) {
    if (!String(url).startsWith(`${LOCAL_ORIGIN}/`)) throw new TypeError('Not a local request');
    if (String(url) === `${LOCAL_ORIGIN}/models`) {
      return new Response(JSON.stringify({ data: LOCAL_MODELS.map((m) => ({ id: m.id })) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(init?.body ?? '{}');
    const e = await load(body.model);
    const signal = init?.signal;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const frame = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const chunks = await e.chat.completions.create({
            messages: body.messages,
            stream: true,
            temperature: 0.2,
            max_tokens: Math.min(body.max_tokens ?? 2048, 4096),
          });
          let finished = false;
          for await (const chunk of chunks) {
            if (signal?.aborted) {
              await e.interruptGenerate?.();
              // Like fetch: an aborted body rejects the reader.
              throw new DOMException('Aborted', 'AbortError');
            }
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            frame({ choices: [{ delta: { content: choice.delta?.content ?? '' }, finish_reason: choice.finish_reason ?? null }] });
            if (choice.finish_reason) finished = true;
          }
          if (!finished && !signal?.aborted) frame({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }] });
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  return {
    load,
    unload,
    fetch: fetchLocal,
    get loadedModel() { return loadedModel; },
    get progress() { return lastProgress; },
    isLoading: () => loading !== null,
  };
}

/** The page's engine. */
export const localProvider = createLocalProvider();
