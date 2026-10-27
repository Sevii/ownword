// Word-level diff with UTF-16 ranges in both texts, for rewrite review and
// for mapping marks onto rewritten text.

import { diffWordsWithSpace } from 'diff';

/** @typedef {{ op: 'equal'|'insert'|'delete', text: string, aFrom: number, aTo: number, bFrom: number, bTo: number }} DiffPart */

/**
 * @param {string} a original
 * @param {string} b revised
 * @returns {DiffPart[]}
 */
export function wordDiff(a, b) {
  /** @type {DiffPart[]} */
  const parts = [];
  let ai = 0;
  let bi = 0;
  for (const c of diffWordsWithSpace(a, b)) {
    const len = c.value.length;
    if (c.added) {
      parts.push({ op: 'insert', text: c.value, aFrom: ai, aTo: ai, bFrom: bi, bTo: bi + len });
      bi += len;
    } else if (c.removed) {
      parts.push({ op: 'delete', text: c.value, aFrom: ai, aTo: ai + len, bFrom: bi, bTo: bi });
      ai += len;
    } else {
      parts.push({ op: 'equal', text: c.value, aFrom: ai, aTo: ai + len, bFrom: bi, bTo: bi + len });
      ai += len;
      bi += len;
    }
  }
  return parts;
}

/**
 * Map an offset in `a` to `b` through a diff. Offsets inside a deleted span
 * map to the start of what replaced it.
 * @param {DiffPart[]} parts @param {number} offset
 */
export function mapOffset(parts, offset) {
  for (const p of parts) {
    if (p.op === 'equal' && offset >= p.aFrom && offset <= p.aTo) return p.bFrom + (offset - p.aFrom);
    if (p.op === 'delete' && offset >= p.aFrom && offset < p.aTo) return p.bFrom;
  }
  const last = parts[parts.length - 1];
  return last ? last.bTo : 0;
}
