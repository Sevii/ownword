// Issue records (contract v1) and anchor validation. Runtime validation is
// hand-written: the page's CSP forbids the eval that schema compilers use.
// Tests check these records against contracts/schemas with Ajv.

import { isValidRange } from '../text/offsets.js';

/**
 * @typedef {import('../types.js').Issue} Issue
 * @typedef {import('../types.js').Snapshot} Snapshot
 * @typedef {import('../types.js').Anchor} Anchor
 * @typedef {import('../types.js').Origin} Origin
 * @typedef {import('../types.js').RawFinding} RawFinding
 */

/**
 * Deterministic ID so a finding keeps its identity across reruns of the same
 * snapshot (dismissals and selection rely on it).
 * @param {Origin} origin @param {Anchor} anchor
 */
export function issueId(origin, anchor) {
  return `${origin.engine}:${origin.ruleId}:${anchor.blockId}:${anchor.from}-${anchor.to}`;
}

/**
 * @param {Snapshot} snapshot
 * @param {RawFinding} raw
 * @param {Omit<Origin, 'ruleId'>} origin
 * @returns {Issue}
 */
export function issueFromRaw(snapshot, raw, origin) {
  const block = snapshot.blocks.find((b) => b.id === raw.blockId);
  const anchor = {
    blockId: raw.blockId,
    from: raw.from,
    to: raw.to,
    expectedText: block ? block.text.slice(raw.from, raw.to) : '',
  };
  const fullOrigin = { ...origin, ruleId: raw.ruleId };
  const replacements = [...new Set(raw.replacements ?? [])]
    .filter((t) => t !== anchor.expectedText)
    .slice(0, 5)
    .map((text) => ({ text }));
  return {
    contractVersion: 1,
    id: issueId(fullOrigin, anchor),
    documentId: snapshot.documentId,
    sourceRevision: snapshot.revision,
    settingsRevision: snapshot.settingsRevision,
    origin: fullOrigin,
    category: raw.category,
    classification: raw.classification,
    severity: raw.severity ?? 'minor',
    anchor,
    message: raw.message.slice(0, 2000),
    replacements,
    state: 'current',
  };
}

/**
 * Check that an anchor points at exactly its expected text in the snapshot,
 * on grapheme boundaries. Returns null when valid, otherwise a reason.
 * @param {Snapshot} snapshot
 * @param {Anchor} anchor
 * @returns {null | 'missing-block' | 'invalid-range' | 'text-mismatch'}
 */
export function anchorProblem(snapshot, anchor) {
  const block = snapshot.blocks.find((b) => b.id === anchor.blockId);
  if (!block) return 'missing-block';
  if (!isValidRange(block.text, anchor.from, anchor.to)) return 'invalid-range';
  if (block.text.slice(anchor.from, anchor.to) !== anchor.expectedText) return 'text-mismatch';
  return null;
}
