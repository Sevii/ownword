// Version history (improvement plan §4.3): compare a recovery copy with the
// current document block by block, pairing blocks by their stable ids and
// showing word-level changes inside each.

import { snapshotFromContent } from './content.js';
import { wordDiff } from '../analysis/edits/diff.js';
import { countWords } from '../analysis/text/segment.js';

/** @typedef {{ id: string, type: string, kind: 'same'|'changed'|'added'|'removed', before: string, after: string, parts: import('../analysis/edits/diff.js').DiffPart[] }} VersionChange */

/** @param {object} content */
export function wordCountOf(content) {
  try {
    return snapshotFromContent(content).blocks.reduce((n, b) => n + countWords(b.text), 0);
  } catch {
    return 0;
  }
}

/**
 * Changes from `older` to `newer`, in the newer document's order, with blocks
 * that only exist in the older version placed where they were.
 * @param {object} older @param {object} newer
 * @returns {{ changes: VersionChange[], changed: number, added: number, removed: number }}
 */
export function diffVersions(older, newer) {
  const a = snapshotFromContent(older).blocks;
  const b = snapshotFromContent(newer).blocks;
  const byIdA = new Map(a.map((x) => [x.id, x]));
  const idsB = new Set(b.map((x) => x.id));
  /** @type {VersionChange[]} */
  const changes = [];
  // Blocks removed before the first surviving block keep their place in order.
  let ai = 0;
  const flushRemoved = (until) => {
    while (ai < a.length && a[ai].id !== until) {
      const x = a[ai++];
      if (!idsB.has(x.id) && x.text.trim()) changes.push({ id: x.id, type: x.type, kind: 'removed', before: x.text, after: '', parts: [{ op: 'delete', text: x.text, aFrom: 0, aTo: x.text.length, bFrom: 0, bTo: 0 }] });
    }
    if (ai < a.length && a[ai].id === until) ai++;
  };
  for (const y of b) {
    const x = byIdA.get(y.id);
    if (x) flushRemoved(y.id);
    if (!x) {
      if (y.text.trim()) changes.push({ id: y.id, type: y.type, kind: 'added', before: '', after: y.text, parts: [{ op: 'insert', text: y.text, aFrom: 0, aTo: 0, bFrom: 0, bTo: y.text.length }] });
    } else if (x.text === y.text && x.type === y.type) {
      changes.push({ id: y.id, type: y.type, kind: 'same', before: x.text, after: y.text, parts: [{ op: 'equal', text: y.text, aFrom: 0, aTo: y.text.length, bFrom: 0, bTo: y.text.length }] });
    } else {
      changes.push({ id: y.id, type: y.type, kind: 'changed', before: x.text, after: y.text, parts: wordDiff(x.text, y.text) });
    }
  }
  flushRemoved(null);
  return {
    changes,
    changed: changes.filter((c) => c.kind === 'changed').length,
    added: changes.filter((c) => c.kind === 'added').length,
    removed: changes.filter((c) => c.kind === 'removed').length,
  };
}
