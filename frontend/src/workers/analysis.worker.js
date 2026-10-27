// Analysis worker: owns the Harper instance and runs the local pipeline off
// the main thread. Runs are serialized; the scheduler discards stale results.

import { LocalLinter } from 'harper.js';
import { binary } from 'harper.js/binary';
import { createHarperEngine } from '../analysis/engines/harper.js';
import { createRulesEngine } from '../analysis/rules/index.js';
import { analyze } from '../analysis/pipeline.js';

const harper = createHarperEngine(new LocalLinter({ binary }));
const rules = createRulesEngine();
const ready = harper.setup().then(
  () => self.postMessage({ type: 'ready' }),
  (err) => self.postMessage({ type: 'fatal', message: String(err?.message ?? err) }),
);

let queue = Promise.resolve();

self.onmessage = (event) => {
  const msg = event.data;
  if (msg?.type !== 'check') return;
  queue = queue.then(async () => {
    try {
      await ready;
      const started = performance.now();
      const { envelope } = await analyze(msg.snapshot, msg.settings, {
        engines: [harper, rules],
        requestId: `local-${msg.token.runId}`,
        suppressions: msg.suppressions,
      });
      self.postMessage({ type: 'result', token: msg.token, envelope, ms: performance.now() - started });
    } catch (err) {
      self.postMessage({ type: 'error', token: msg.token, message: String(err?.message ?? err) });
    }
  });
};
