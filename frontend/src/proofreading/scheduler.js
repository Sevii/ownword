// Main-thread check scheduler (docs/proofreading-design.md §4): debounce,
// at most one active run plus one coalesced pending run, stale-result
// rejection by check token, and one controlled worker restart on failure.

/**
 * @typedef {{ documentId: string, revision: number, settingsRevision: number, runId: number }} CheckToken
 * @typedef {'idle'|'waiting'|'checking'|'current'|'paused'|'failed'|'unavailable'} CheckStatus
 */

/**
 * @param {{
 *   createWorker: () => Worker,
 *   getRequest: () => null | { snapshot: object, settings: object, suppressions: object, positions: Map<string, number> },
 *   isCurrent: (token: CheckToken) => boolean,
 *   isComposing: () => boolean,
 *   onResult: (envelope: import('../analysis/types.js').Envelope, positions: Map<string, number>, ms: number, snapshot: object) => void,
 *   onStatus: (status: CheckStatus, detail?: string) => void,
 *   debounceMs?: number,
 * }} opts
 */
export function createScheduler(opts) {
  const debounceMs = opts.debounceMs ?? 300;
  let worker = null;
  let crashes = 0;
  let runId = 0;
  /** @type {null | { token: CheckToken, positions: Map<string, number>, snapshot: object }} */
  let active = null;
  let pending = false;
  let paused = false;
  let timer = 0;

  function start() {
    worker = opts.createWorker();
    worker.onmessage = onMessage;
    worker.onerror = (e) => {
      e.preventDefault?.();
      fail(e.message || 'Checker crashed');
    };
  }

  function fail(detail) {
    active = null;
    worker?.terminate();
    worker = null;
    crashes++;
    if (crashes <= 1) {
      start();
      schedule(true);
    } else {
      opts.onStatus('unavailable', detail);
    }
  }

  function onMessage(event) {
    const msg = event.data;
    if (msg.type === 'fatal') return fail(msg.message);
    if (msg.type !== 'result' && msg.type !== 'error') return;
    if (!active || msg.token.runId !== active.token.runId) return;
    const { positions, snapshot } = active;
    active = null;
    if (msg.type === 'error') {
      opts.onStatus('failed', msg.message);
    } else if (opts.isCurrent(msg.token)) {
      crashes = 0;
      opts.onResult(msg.envelope, positions, msg.ms, snapshot);
      opts.onStatus(msg.envelope.status === 'failed' ? 'failed' : 'current');
    } else {
      pending = true;
    }
    if (pending) {
      pending = false;
      run();
    }
  }

  function run() {
    timer = 0;
    if (paused || !worker) return;
    if (opts.isComposing()) {
      schedule();
      return;
    }
    if (active) {
      pending = true;
      return;
    }
    const req = opts.getRequest();
    if (!req) return;
    const token = {
      documentId: req.snapshot.documentId,
      revision: req.snapshot.revision,
      settingsRevision: req.snapshot.settingsRevision,
      runId: ++runId,
    };
    active = { token, positions: req.positions, snapshot: req.snapshot };
    opts.onStatus('checking');
    worker.postMessage({ type: 'check', token, snapshot: req.snapshot, settings: req.settings, suppressions: req.suppressions });
  }

  function schedule(immediate = false) {
    if (paused) return;
    clearTimeout(timer);
    if (!active) opts.onStatus('waiting');
    timer = setTimeout(run, immediate ? 0 : debounceMs);
  }

  start();
  return {
    /** Request a check after the debounce, or immediately. */
    schedule,
    pause() {
      paused = true;
      clearTimeout(timer);
      // Ignore the result of a check already running; resume() checks again.
      active = null;
      pending = false;
      opts.onStatus('paused');
    },
    resume() {
      paused = false;
      schedule(true);
    },
    /** Retry after repeated failure. */
    retry() {
      crashes = 0;
      if (!worker) start();
      schedule(true);
    },
    destroy() {
      clearTimeout(timer);
      worker?.terminate();
      worker = null;
    },
  };
}
