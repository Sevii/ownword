// Apply accepted replacements as one undoable transaction, after
// revalidating against the live document (contract §5).

import { planEdits } from '../analysis/edits/plan-edits.js';
import { snapshotFromDoc } from './snapshot-from-editor.js';

/**
 * Replace [from, to) with plain text in `tr`. The edit policy guarantees
 * uniform marks across the range, so the first character's marks apply to
 * the whole replacement. An insertion keeps only marks on both sides of it:
 * inside bold stays bold, but text next to bold doesn't become bold.
 */
function replaceText(tr, state, from, to, text) {
  if (!text) {
    tr.delete(from, to);
    return;
  }
  let marks = state.doc.nodeAt(from)?.marks ?? [];
  if (from === to) {
    const $pos = state.doc.resolve(from);
    const before = $pos.nodeBefore?.marks ?? [];
    marks = ($pos.nodeAfter?.marks ?? []).filter((m) => m.isInSet(before));
  }
  tr.replaceWith(from, to, state.schema.text(text, marks));
}

/**
 * @param {import('@tiptap/core').Editor} editor
 * @param {{ documentId: string, revision: number, settingsRevision: number }} current
 * @param {import('../analysis/types.js').Issue} issue
 * @param {string} text replacement
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function applyReplacement(editor, current, issue, text) {
  if (issue.documentId !== current.documentId) return { ok: false, reason: 'other-document' };
  if (issue.sourceRevision !== current.revision) return { ok: false, reason: 'stale' };
  const a = issue.anchor;
  if (!a) return { ok: false, reason: 'not-anchored' };
  return applyEdits(editor, current, [{ blockId: a.blockId, from: a.from, to: a.to, expectedText: a.expectedText, text }], {
    meta: issue.id,
  });
}

/**
 * Apply several block-local edits in one transaction (one undo step). Every
 * edit is checked against the live document first; if any fails, nothing
 * changes.
 * @param {import('@tiptap/core').Editor} editor
 * @param {{ documentId: string, revision: number, settingsRevision: number }} current
 * @param {import('../analysis/edits/plan-edits.js').Edit[]} edits
 * @param {{ meta?: string }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function applyEdits(editor, current, edits, opts = {}) {
  if (!edits.length) return { ok: false, reason: 'nothing-to-apply' };
  const { snapshot, positions } = snapshotFromDoc(editor.state.doc, current);
  const plan = planEdits(snapshot, edits);
  if (!plan.ok) return { ok: false, reason: plan.problems[0].problem };
  const { state } = editor;
  const tr = state.tr;
  // Plan order is descending within each block and across blocks, so earlier
  // positions are unaffected by later replacements.
  for (const e of plan.edits) {
    const start = positions.get(e.blockId);
    replaceText(tr, state, start + e.from, start + e.to, e.text);
  }
  tr.setMeta('ow:apply', opts.meta ?? 'edits');
  editor.view.dispatch(tr);
  return { ok: true };
}
