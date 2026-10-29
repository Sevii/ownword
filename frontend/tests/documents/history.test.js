import { describe, it, expect } from 'vitest';
import { diffVersions, wordCountOf } from '../../src/documents/history.js';

const doc = (blocks) => ({ type: 'doc', content: blocks.map(([id, text, type = 'paragraph']) => ({ type, attrs: type === 'heading' ? { level: 1, blockId: id } : { blockId: id }, content: text ? [{ type: 'text', text }] : [] })) });

describe('version history diff (plan §4.3)', () => {
  it('pairs blocks by id, with word-level changes, additions, and removals in order', () => {
    const older = doc([['h', 'Title', 'heading'], ['a', 'The quick fox.'], ['b', 'Gone soon.'], ['c', 'Stays.']]);
    const newer = doc([['h', 'Title', 'heading'], ['a', 'The slow fox.'], ['c', 'Stays.'], ['d', 'Brand new.']]);
    const r = diffVersions(older, newer);
    expect(r.changes.map((c) => [c.id, c.kind])).toEqual([['h', 'same'], ['a', 'changed'], ['b', 'removed'], ['c', 'same'], ['d', 'added']]);
    expect(r).toMatchObject({ changed: 1, added: 1, removed: 1 });
    const a = r.changes[1];
    expect(a.parts.filter((p) => p.op === 'delete').map((p) => p.text)).toEqual(['quick']);
    expect(a.parts.filter((p) => p.op === 'insert').map((p) => p.text)).toEqual(['slow']);
  });

  it('ignores empty blocks and counts words', () => {
    const r = diffVersions(doc([['a', 'One two.'], ['e', '']]), doc([['a', 'One two.'], ['f', '']]));
    expect(r.changes.filter((c) => c.kind !== 'same')).toEqual([]);
    expect(wordCountOf(doc([['a', 'One two three.'], ['b', 'Four.']]))).toBe(4);
    expect(wordCountOf({ nope: 1 })).toBe(0);
  });
});
