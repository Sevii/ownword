// Turn accepted replacements into a validated edit plan against a snapshot
// (contract §5). The editor commits a plan in one transaction after
// rechecking its live state; applyPlanToSnapshot does the same for plain text.

import { isValidRange } from '../text/offsets.js';
import { makeBlock } from '../snapshot/from-markdown.js';

/**
 * @typedef {import('../types.js').Snapshot} Snapshot
 * @typedef {{ blockId: string, from: number, to: number, expectedText: string, text: string }} Edit
 * @typedef {'missing-block'|'invalid-range'|'text-mismatch'|'overlap'|'crosses-link'|'crosses-format'|'deletes-link'|'unsafe-text'} EditProblem
 */

// Control characters and Unicode line/paragraph separators never belong in a
// plain-text replacement.
const UNSAFE_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u2028\u2029]/u;

/**
 * @param {Snapshot} snapshot
 * @param {Edit[]} edits
 * @returns {{ ok: true, edits: Edit[] } | { ok: false, problems: { edit: Edit, problem: EditProblem }[] }}
 */
export function planEdits(snapshot, edits) {
  const blocks = new Map(snapshot.blocks.map((b, i) => [b.id, { block: b, index: i }]));
  /** @type {{ edit: Edit, problem: EditProblem }[]} */
  const problems = [];
  for (const edit of edits) {
    const entry = blocks.get(edit.blockId);
    if (!entry) {
      problems.push({ edit, problem: 'missing-block' });
      continue;
    }
    const { text, marks } = entry.block;
    if (!isValidRange(text, edit.from, edit.to)) problems.push({ edit, problem: 'invalid-range' });
    else if (text.slice(edit.from, edit.to) !== edit.expectedText) problems.push({ edit, problem: 'text-mismatch' });
    else if (UNSAFE_TEXT.test(edit.text)) problems.push({ edit, problem: 'unsafe-text' });
    else {
      const markProblem = formattingProblem(marks, edit);
      if (markProblem) problems.push({ edit, problem: markProblem });
    }
  }
  const sorted = [...edits].sort(
    (a, b) => (blocks.get(b.blockId)?.index ?? 0) - (blocks.get(a.blockId)?.index ?? 0) || b.from - a.from || b.to - a.to,
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.blockId !== cur.blockId) continue;
    // Sorted descending: cur starts at or before prev.
    const overlaps = cur.to > prev.from || (cur.from === prev.from && cur.to === prev.to);
    if (overlaps) problems.push({ edit: cur, problem: 'overlap' });
  }
  return problems.length ? { ok: false, problems } : { ok: true, edits: sorted };
}

/**
 * Formatting policy for a plain-text replacement: it may sit entirely inside
 * a mark (and inherits it) or entirely outside it. Partially overlapping a
 * mark is blocked, and so is deleting a whole link.
 * @param {import('../types.js').MarkSpan[]} marks
 * @param {Edit} edit
 * @returns {EditProblem | null}
 */
function formattingProblem(marks, edit) {
  for (const m of marks) {
    const inside = edit.from >= m.from && edit.to <= m.to;
    const outside = edit.to <= m.from || edit.from >= m.to;
    if (inside) {
      if (m.type === 'link' && edit.from === m.from && edit.to === m.to && !edit.text) return 'deletes-link';
      continue;
    }
    if (outside) continue;
    return m.type === 'link' ? 'crosses-link' : 'crosses-format';
  }
  return null;
}

/**
 * Apply a validated plan to a snapshot's text, shifting marks. Used by tests,
 * the eval harness, and plain-text hosts such as the extension.
 * @param {Snapshot} snapshot
 * @param {Edit[]} plan descending order, from planEdits
 * @returns {Snapshot}
 */
export function applyPlanToSnapshot(snapshot, plan) {
  const byBlock = new Map();
  for (const e of plan) byBlock.set(e.blockId, [...(byBlock.get(e.blockId) ?? []), e]);
  const blocks = snapshot.blocks.map((b) => {
    const edits = byBlock.get(b.id);
    if (!edits) return b;
    let text = b.text;
    let marks = b.marks.map((m) => ({ ...m }));
    for (const e of edits) {
      text = text.slice(0, e.from) + e.text + text.slice(e.to);
      const delta = e.text.length - (e.to - e.from);
      marks = marks.map((m) => {
        if (m.to <= e.from) return m;
        if (m.from >= e.to) return { ...m, from: m.from + delta, to: m.to + delta };
        return { ...m, to: m.to + delta };
      });
    }
    const { id, fingerprint: _f, ...rest } = b;
    return makeBlock({ ...rest, text, marks: marks.filter((m) => m.to > m.from) }, id);
  });
  return { ...snapshot, revision: snapshot.revision + 1, blocks };
}
