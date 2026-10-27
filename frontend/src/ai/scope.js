// What an AI action works on: whole blocks touched by the selection, or the
// whole document. Code blocks are never rewritten, only sent as context, and
// a selection gets its neighboring blocks as read-only context.

import { countWords } from '../analysis/text/segment.js';

/** Per-action word limit to keep provider requests bounded. */
export const MAX_WORDS = 5000;

/**
 * @typedef {{ kind: 'selection'|'document', editableBlockIds: string[], contextBlockIds: string[],
 *   words: number, tooLarge: boolean, empty: boolean }} Scope
 */

/**
 * @param {import('../analysis/types.js').Snapshot} snapshot
 * @param {Map<string, number>} positions block ID -> content start
 * @param {{ from: number, to: number } | null} selection editor selection, or null for the document
 * @returns {Scope}
 */
export function buildScope(snapshot, positions, selection) {
  const blocks = snapshot.blocks;
  const touched = (b) => {
    if (!selection || selection.from === selection.to) return true;
    const start = positions.get(b.id);
    if (start === undefined) return false;
    // Strict: a selection that only reaches a block's edge (dragging to the start
    // of the next paragraph) covers none of its text.
    return selection.from < start + b.text.length && selection.to > start;
  };
  const kind = selection && selection.from !== selection.to ? 'selection' : 'document';
  const chosen = blocks.filter(touched);
  const editable = chosen.filter((b) => b.type !== 'codeBlock' && b.text.trim());
  const editableIds = new Set(editable.map((b) => b.id));
  const context = new Set(chosen.filter((b) => !editableIds.has(b.id) && b.text.trim()).map((b) => b.id));
  if (kind === 'selection' && chosen.length) {
    const first = blocks.indexOf(chosen[0]);
    const last = blocks.indexOf(chosen[chosen.length - 1]);
    for (const b of [blocks[first - 1], blocks[last + 1]]) if (b?.text.trim()) context.add(b.id);
  }
  const words = blocks.filter((b) => editableIds.has(b.id) || context.has(b.id)).reduce((n, b) => n + countWords(b.text), 0);
  return {
    kind,
    editableBlockIds: blocks.filter((b) => editableIds.has(b.id)).map((b) => b.id),
    contextBlockIds: blocks.filter((b) => context.has(b.id)).map((b) => b.id),
    words,
    tooLarge: words > MAX_WORDS,
    empty: editable.length === 0,
  };
}

/**
 * The request blocks (contract: id, type, text) for a scope, in document order.
 * @param {import('../analysis/types.js').Snapshot} snapshot
 * @param {Scope} scope
 * @param {{ id: string, type: string, text: string }[]} [extra] appended blocks, such as a proposed revision
 */
export function scopeBlocks(snapshot, scope, extra = []) {
  const ids = new Set([...scope.editableBlockIds, ...scope.contextBlockIds]);
  return [
    ...snapshot.blocks.filter((b) => ids.has(b.id)).map((b) => ({ id: b.id, type: b.level ? `${b.type}${b.level}` : b.type, text: b.text })),
    ...extra,
  ];
}
