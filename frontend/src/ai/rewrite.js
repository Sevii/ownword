// A validated rewrite becomes a proposal: per-block word diffs, protected-span
// changes from the meaning guard, and the smallest edits that produce the new
// text. Unchanged words keep their formatting because only changed spans are
// replaced. A block whose change would cross formatting it can't keep is left
// out of Apply and says why; formatting is never flattened to make it apply.

import { wordDiff } from '../analysis/edits/diff.js';
import { planEdits } from '../analysis/edits/plan-edits.js';
import { compareProtected } from '../analysis/meaning/protected.js';

const PROBLEM_TEXT = {
  'crosses-format': 'This change would split bold, italic, or code formatting, so it is left out.',
  'crosses-link': 'This change would cut through a link, so it is left out.',
  'deletes-link': 'This change would delete a link, so it is left out.',
  'unsafe-text': 'This change contains characters that cannot be placed in the document.',
  'text-mismatch': 'The text changed after the request, so this change no longer fits.',
  'missing-block': 'This paragraph no longer exists.',
  'invalid-range': 'This change does not line up with the text.',
  overlap: 'This change overlaps another change.',
};

/**
 * @typedef {import('../analysis/edits/plan-edits.js').Edit} Edit
 * @typedef {{ blockId: string, type: string, before: string, after: string,
 *   parts: import('../analysis/edits/diff.js').DiffPart[], edits: Edit[], problem: string | null,
 *   meaning: { removed: { text: string, kind: string }[], added: { text: string, kind: string }[] } }} BlockChange
 * @typedef {{ sourceRevision: number, changes: BlockChange[], unchanged: number, edits: Edit[] }} Proposal
 */

/** Group consecutive non-equal diff parts into replacement edits. */
export function diffEdits(blockId, before, parts) {
  /** @type {Edit[]} */
  const edits = [];
  let open = null;
  for (const p of parts) {
    if (p.op === 'equal') {
      if (open) edits.push(open);
      open = null;
      continue;
    }
    open ??= { blockId, from: p.aFrom, to: p.aFrom, expectedText: '', text: '' };
    if (p.op === 'delete') open.to = p.aTo;
    else open.text += p.text;
  }
  if (open) edits.push(open);
  for (const e of edits) e.expectedText = before.slice(e.from, e.to);
  return edits;
}

/**
 * @param {import('../analysis/types.js').Snapshot} snapshot the snapshot the request was made from
 * @param {{ id: string, text: string }[]} blocks validated rewrite blocks
 * @returns {Proposal}
 */
export function proposeRewrite(snapshot, blocks) {
  const source = new Map(snapshot.blocks.map((b) => [b.id, b]));
  /** @type {BlockChange[]} */
  const changes = [];
  let unchanged = 0;
  for (const { id, text } of blocks) {
    const b = source.get(id);
    if (!b || b.text === text) {
      unchanged++;
      continue;
    }
    const parts = wordDiff(b.text, text);
    const edits = diffEdits(id, b.text, parts);
    const { removed, added } = compareProtected(b.text, text);
    const plan = planEdits(snapshot, edits);
    const problem = plan.ok ? null : PROBLEM_TEXT[plan.problems[0].problem] ?? 'This change cannot be applied safely.';
    changes.push({
      blockId: id,
      type: b.type,
      before: b.text,
      after: text,
      parts,
      edits,
      problem,
      meaning: {
        removed: removed.map((s) => ({ text: s.text, kind: s.kind })),
        added: added.map((s) => ({ text: s.text, kind: s.kind })),
      },
    });
  }
  return {
    sourceRevision: snapshot.revision,
    changes,
    unchanged,
    edits: changes.filter((c) => !c.problem).flatMap((c) => c.edits),
  };
}

/** Plain-language names for protected span kinds, for meaning-guard warnings. */
export const PROTECTED_LABELS = {
  money: 'amount',
  percent: 'percentage',
  number: 'number',
  date: 'date',
  time: 'time',
  negation: 'negation',
  modality: 'obligation or possibility',
  condition: 'condition',
  name: 'name',
  quote: 'quotation',
  url: 'link',
};
