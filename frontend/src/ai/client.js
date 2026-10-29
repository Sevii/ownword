import { buildPrompt, PROMPT_VERSION } from './prompts.js';
import { generationRequest, statusError, statusMessage, NETWORK_MESSAGE } from './providers.js';

// Translate direct provider SSE into the editor's existing review events.
// Only an explicit successful finish can make a partial preview applicable.
export async function runAiRequest(body, opts = {}) {
  const requestId = body.clientRequestId ?? crypto.randomUUID();
  let preview = '', terminal = null;
  const emit = (event) => opts.onEvent?.({ requestId, ...event }, preview);
  const finish = (event) => { if (!terminal) { terminal = { requestId, ...event }; emit(terminal); } };
  const abort = new AbortController();
  const cancel = () => abort.abort();
  opts.signal?.addEventListener('abort', cancel, { once: true });
  if (opts.signal?.aborted) cancel();
  const timer = setTimeout(cancel, 180000);
  let reader;
  try {
    if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const req = generationRequest(body, buildPrompt(body), opts.key, opts.baseUrl);
    const res = await (opts.fetchImpl ?? fetch)(req.url, { ...req.init, signal: abort.signal });
    if (!res.ok) {
      finish({ type: 'failed', error: statusError(res.status), message: statusMessage(res.status) });
    } else if (!res.body) {
      throw new Error('Missing response body');
    } else {
      emit({ type: 'started', model: body.model, promptVersion: PROMPT_VERSION });
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', stopped = false;
      const process = (frame) => {
        const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!data || terminal) return;
        if (data === '[DONE]') {
          if (!stopped) throw new Error('Missing finish reason');
          return;
        }
        const e = JSON.parse(data);
        if (e.error || e.type === 'error' || ['response.failed','response.incomplete'].includes(e.type)) throw new Error('Provider generation failed');
        let text = '', done = false;
        if (body.provider === 'openai') {
          if (e.type === 'response.output_text.delta') text = e.delta;
          if (e.type === 'response.completed') done = e.response?.status === 'completed';
        } else if (body.provider === 'anthropic') {
          if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') text = e.delta.text;
          if (e.type === 'message_delta') {
            if (!['end_turn', 'stop_sequence'].includes(e.delta?.stop_reason)) throw new Error('Incomplete response');
            stopped = true;
          }
          if (e.type === 'message_stop') done = stopped;
        } else if (body.provider === 'gemini') {
          if (e.promptFeedback?.blockReason) throw new Error('Blocked response');
          const c = e.candidates?.[0];
          text = (c?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? '').join('');
          if (c?.finishReason) {
            if (c.finishReason !== 'STOP') throw new Error('Incomplete response');
            done = true;
          }
        } else {
          const c = e.choices?.[0];
          text = c?.delta?.content ?? '';
          if (c?.finish_reason) {
            if (c.finish_reason !== 'stop') throw new Error('Incomplete response');
            done = true;
          }
        }
        if (typeof text !== 'string') throw new Error('Unreadable response');
        if (text) { preview += text; if (preview.length > 500000) throw new Error('Response too large'); emit({ type: 'delta', text }); }
        if (done) {
          stopped = true;
          if (!preview.trim()) throw new Error('Empty response');
          finish({ type: 'completed', text: preview });
        }
      };
      while (!terminal) {
        const { value, done } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        // Normalize CRLF after buffering so a split CR/LF pair stays intact.
        buffer = buffer.replace(/\r\n/gu, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0 && !terminal) {
          process(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
        }
        if (buffer.length > 1000000) throw new Error('Response too large');
        if (done) { if (buffer.trim() && !terminal) process(buffer); break; }
      }
      if (!terminal) finish({ type: 'failed', error: 'unavailable', message: 'The response ended before it was complete. Try again.' });
    }
  } catch (err) {
    finish(opts.signal?.aborted ? { type: 'cancelled' } : {
      type: 'failed', error: 'unavailable',
      message: abort.signal.aborted ? 'The request timed out. Try a smaller passage.' : err instanceof TypeError ? NETWORK_MESSAGE : 'The provider returned an incomplete or unreadable response. Try again or choose another model.',
    });
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', cancel);
    if (reader) await reader.cancel().catch(() => {});
  }
  return { requestId, terminal, preview };
}
