import { describe, it, expect } from 'vitest';
import { advanceGoal } from '../../src/app/goal.js';

describe('daily word goal (plan §4.5)', () => {
  it('counts growth per document after a baseline, never shrinkage, and resets on a new day', () => {
    const baselines = new Map();
    let p = { date: '2026-10-29', words: 0 };
    p = advanceGoal(p, baselines, 'a', 100, '2026-10-29'); // baseline only
    expect(p.words).toBe(0);
    p = advanceGoal(p, baselines, 'a', 130, '2026-10-29');
    expect(p.words).toBe(30);
    p = advanceGoal(p, baselines, 'a', 120, '2026-10-29'); // deleted some
    expect(p.words).toBe(30);
    p = advanceGoal(p, baselines, 'a', 125, '2026-10-29'); // retyped: only growth past the last count
    expect(p.words).toBe(35);
    p = advanceGoal(p, baselines, 'b', 10, '2026-10-29'); // another document's baseline
    p = advanceGoal(p, baselines, 'b', 15, '2026-10-29');
    expect(p.words).toBe(40);
    p = advanceGoal(p, baselines, 'b', 20, '2026-10-30');
    expect(p).toEqual({ date: '2026-10-30', words: 5 });
  });
  it('returns the same object when nothing changed', () => {
    const baselines = new Map([['a', 50]]);
    const p = { date: '2026-10-29', words: 7 };
    expect(advanceGoal(p, baselines, 'a', 50, '2026-10-29')).toBe(p);
  });
});
