import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScheduler } from '../../src/proofreading/scheduler.js';

// A fake worker that answers when told to.
class FakeWorker {
  static instances = [];
  constructor() {
    this.sent = [];
    FakeWorker.instances.push(this);
  }
  postMessage(msg) { this.sent.push(msg); }
  terminate() { this.terminated = true; }
  reply(i, extra = {}) {
    const msg = this.sent[i];
    this.onmessage({ data: { type: 'result', token: msg.token, envelope: { status: 'completed', findings: [] }, ms: 1, ...extra } });
  }
}

describe('scheduler', () => {
  let revision;
  let results;
  let statuses;
  let sched;
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    revision = 1;
    results = [];
    statuses = [];
    sched = createScheduler({
      createWorker: () => new FakeWorker(),
      getRequest: () => ({ snapshot: { documentId: 'd', revision, settingsRevision: 0 }, settings: {}, suppressions: {}, positions: new Map() }),
      isCurrent: (t) => t.revision === revision,
      isComposing: () => false,
      onResult: (env) => results.push(env),
      onStatus: (s) => statuses.push(s),
    });
  });
  afterEach(() => {
    sched.destroy();
    vi.useRealTimers();
  });

  it('debounces bursts of edits into one run', () => {
    for (let i = 0; i < 5; i++) sched.schedule();
    vi.advanceTimersByTime(299);
    expect(FakeWorker.instances[0].sent.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(FakeWorker.instances[0].sent.length).toBe(1);
  });

  it('discards a stale result and reruns the latest revision', () => {
    const w = FakeWorker.instances[0];
    sched.schedule(true);
    vi.advanceTimersByTime(0);
    revision = 2;
    w.reply(0);
    expect(results).toEqual([]);
    expect(w.sent.length).toBe(2);
    expect(w.sent[1].token.revision).toBe(2);
    w.reply(1);
    expect(results.length).toBe(1);
    expect(statuses.at(-1)).toBe('current');
  });

  it('coalesces requests made while a run is active', () => {
    const w = FakeWorker.instances[0];
    sched.schedule(true);
    vi.advanceTimersByTime(0);
    sched.schedule(true);
    sched.schedule(true);
    vi.advanceTimersByTime(0);
    expect(w.sent.length).toBe(1);
    w.reply(0);
    expect(w.sent.length).toBe(2);
  });

  it('ignores out-of-order replies from earlier runs', () => {
    const w = FakeWorker.instances[0];
    sched.schedule(true);
    vi.advanceTimersByTime(0);
    w.reply(0);
    sched.schedule(true);
    vi.advanceTimersByTime(0);
    w.reply(0); // duplicate of the old run
    expect(results.length).toBe(1);
  });

  it('restarts a crashed worker once, then reports unavailable', () => {
    FakeWorker.instances[0].onerror({ message: 'boom' });
    expect(FakeWorker.instances.length).toBe(2);
    FakeWorker.instances[1].onerror({ message: 'boom' });
    expect(FakeWorker.instances.length).toBe(2);
    expect(statuses.at(-1)).toBe('unavailable');
    sched.retry();
    expect(FakeWorker.instances.length).toBe(3);
  });

  it('does nothing while paused', () => {
    sched.pause();
    sched.schedule(true);
    vi.advanceTimersByTime(1000);
    expect(FakeWorker.instances[0].sent.length).toBe(0);
    sched.resume();
    vi.advanceTimersByTime(0);
    expect(FakeWorker.instances[0].sent.length).toBe(1);
  });
  it('ignores a check that was running when checking was paused', () => {
    const w = FakeWorker.instances[0];
    sched.schedule(true);
    vi.advanceTimersByTime(0);
    sched.pause();
    w.reply(0);
    expect(results).toEqual([]);
    expect(statuses.at(-1)).toBe('paused');
    sched.resume();
    vi.advanceTimersByTime(0);
    expect(w.sent.length).toBe(2);
  });
});

describe('scheduler result payload', () => {
  it('hands back the snapshot the result was computed from', () => {
    vi.useFakeTimers();
    FakeWorker.instances = [];
    const got = [];
    const snap = { documentId: 'd', revision: 1, settingsRevision: 0 };
    const s = createScheduler({
      createWorker: () => new FakeWorker(),
      getRequest: () => ({ snapshot: snap, settings: {}, suppressions: {}, positions: new Map() }),
      isCurrent: () => true,
      isComposing: () => false,
      onResult: (env, positions, ms, snapshot) => got.push(snapshot),
      onStatus: () => {},
    });
    s.schedule(true);
    vi.advanceTimersByTime(0);
    FakeWorker.instances[0].reply(0);
    expect(got).toEqual([snap]);
    s.destroy();
    vi.useRealTimers();
  });
});
