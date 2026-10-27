// Resolve an exact quote to a UTF-16 range (contract §4). Used for AI
// findings and for eval cases, which cite quotes rather than offsets.
// Never guesses: an absent or ambiguous quote is rejected.

import { isValidRange } from '../text/offsets.js';

/**
 * @typedef {import('../types.js').Snapshot} Snapshot
 * @typedef {import('../types.js').Evidence} Evidence
 * @typedef {import('../types.js').Anchor} Anchor
 */

/**
 * @param {Snapshot} snapshot
 * @param {Evidence} evidence
 * @param {{ allowedBlockIds?: Iterable<string> }} [options]
 * @returns {{ ok: true, anchor: Anchor } | { ok: false, reason: 'out-of-scope'|'missing-block'|'not-found'|'ambiguous'|'invalid-boundary', matches?: number }}
 */
export function resolveEvidence(snapshot, evidence, options = {}) {
  if (options.allowedBlockIds && !new Set(options.allowedBlockIds).has(evidence.blockId)) {
    return { ok: false, reason: 'out-of-scope' };
  }
  const block = snapshot.blocks.find((b) => b.id === evidence.blockId);
  if (!block) return { ok: false, reason: 'missing-block' };
  const { text } = block;
  const quote = evidence.quote;
  if (!quote) return { ok: false, reason: 'not-found' };

  let matches = [];
  for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) matches.push(i);
  if (!matches.length) return { ok: false, reason: 'not-found' };
  if (matches.length > 1 && (evidence.before || evidence.after)) {
    matches = matches.filter(
      (i) =>
        (!evidence.before || text.slice(0, i).endsWith(evidence.before)) &&
        (!evidence.after || text.slice(i + quote.length).startsWith(evidence.after)),
    );
  }
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length ? 'ambiguous' : 'not-found', matches: matches.length };
  }
  const from = matches[0];
  const to = from + quote.length;
  if (!isValidRange(text, from, to)) return { ok: false, reason: 'invalid-boundary' };
  return { ok: true, anchor: { blockId: block.id, from, to, expectedText: quote } };
}
