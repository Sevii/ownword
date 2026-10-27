// Build an analysis snapshot from ProseMirror state. This is the only
// editor-aware piece of the analysis path.
//
// Position mapping: within a textblock, every text character is one UTF-16
// unit and one ProseMirror position, and any inline leaf node is one position
// represented by U+FFFC. So a block-local offset maps to contentStart + offset.

import { makeBlock, SNAPSHOT_SCHEMA_VERSION } from '../analysis/snapshot/from-markdown.js';

const MARK_TYPES = new Set(['bold', 'italic', 'code', 'link']);

/**
 * @param {import('@tiptap/pm/model').Node} doc
 * @param {{ documentId: string, revision: number, settingsRevision: number }} meta
 * @returns {{ snapshot: import('../analysis/types.js').Snapshot, positions: Map<string, number> }}
 */
export function snapshotFromDoc(doc, meta) {
  const blocks = [];
  /** @type {Map<string, number>} */
  const positions = new Map();
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) return true;
    let text = '';
    /** @type {import('../analysis/types.js').MarkSpan[]} */
    const marks = [];
    node.forEach((child) => {
      const from = text.length;
      text += child.isText ? child.text : '￼';
      for (const m of child.marks) {
        if (!MARK_TYPES.has(m.type.name)) continue;
        const span = { from, to: text.length, type: m.type.name, ...(m.type.name === 'link' ? { href: m.attrs.href } : {}) };
        const last = marks.findLast((x) => x.type === span.type && x.to === from && x.href === span.href);
        if (last) last.to = span.to;
        else marks.push(span);
      }
    });
    const type =
      node.type.name === 'heading' ? 'heading'
      : node.type.name === 'codeBlock' ? 'codeBlock'
      : parent?.type.name === 'listItem' ? 'listItem'
      : parent?.type.name === 'blockquote' ? 'blockquote'
      : 'paragraph';
    const id = node.attrs.blockId ?? `pending-${pos}`;
    marks.sort((a, b) => a.from - b.from || a.to - b.to);
    blocks.push(makeBlock({ type, level: type === 'heading' ? node.attrs.level : undefined, text, marks }, id));
    positions.set(id, pos + 1);
    return false;
  });
  return {
    snapshot: {
      contractVersion: 1,
      documentId: meta.documentId,
      revision: meta.revision,
      settingsRevision: meta.settingsRevision,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      blocks,
    },
    positions,
  };
}
