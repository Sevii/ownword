// AI findings outlive the snapshot they were made from. After an edit, each
// one is re-anchored in the new snapshot: first at its position mapped
// through the edits (it must still hold exactly the expected text), then at
// its own anchor if the snapshot is the one it was made from, else by
// finding that text again, which must then occur exactly once in its block.
// Anything else is dropped rather than guessed (contract §4).

import { resolveEvidence } from '../analysis/edits/resolve-evidence.js';
import { anchorProblem } from '../analysis/issues/issue.js';

/**
 * @param {import('../analysis/types.js').Issue[]} issues anchored AI issues
 * @param {import('../analysis/types.js').Snapshot} snapshot
 * @param {Map<string, number>} positions block ID -> content start, for `snapshot`
 * @param {Map<string, { from: number, to: number }> | null} ranges issue ID -> mapped absolute range
 * @returns {import('../analysis/types.js').Issue[]}
 */
export function reanchor(issues, snapshot, positions, ranges) {
  const out = [];
  for (const issue of issues) {
    const a = issue.anchor;
    if (!a) continue;
    const anchor = atMappedRange(snapshot, positions, ranges?.get(issue.id), a.expectedText)
      ?? atOwnAnchor(issue, snapshot)
      ?? byQuote(snapshot, a.blockId, a.expectedText);
    if (!anchor) continue;
    out.push({ ...issue, anchor, sourceRevision: snapshot.revision, settingsRevision: snapshot.settingsRevision });
  }
  return out;
}

function atMappedRange(snapshot, positions, range, expectedText) {
  if (!range) return null;
  for (const b of snapshot.blocks) {
    const start = positions.get(b.id);
    if (start === undefined || range.from < start || range.to > start + b.text.length) continue;
    const from = range.from - start;
    const to = range.to - start;
    return b.text.slice(from, to) === expectedText ? { blockId: b.id, from, to, expectedText } : null;
  }
  return null;
}

// A finding placed by its quote's context (before/after) keeps only the anchor,
// so its own anchor is the only way to place it again in the same text.
function atOwnAnchor(issue, snapshot) {
  if (issue.documentId !== snapshot.documentId || issue.sourceRevision !== snapshot.revision) return null;
  return anchorProblem(snapshot, issue.anchor) ? null : issue.anchor;
}

function byQuote(snapshot, blockId, quote) {
  if (!quote) return null;
  const r = resolveEvidence(snapshot, { blockId, quote });
  return r.ok ? r.anchor : null;
}
