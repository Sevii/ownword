// Build snapshots from plain text or a small Markdown subset, for tests, eval
// cases, and plain-text selections. The editor builds its own snapshots from
// Tiptap state (src/editor/snapshot-from-editor.js).

import { blockFingerprint } from './fingerprint.js';

export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * @typedef {import('../types.js').Block} Block
 * @typedef {import('../types.js').Snapshot} Snapshot
 */

/**
 * @param {Partial<Block> & { type: Block['type'], text: string }} b
 * @param {string} id
 * @returns {Block}
 */
export function makeBlock(b, id) {
  const block = { id, type: b.type, ...(b.level ? { level: b.level } : {}), text: b.text, marks: b.marks ?? [] };
  return { ...block, fingerprint: blockFingerprint(block) };
}

/**
 * @param {Array<Partial<Block> & { type: Block['type'], text: string }>} blocks
 * @param {{ documentId?: string, revision?: number, settingsRevision?: number }} [meta]
 * @returns {Snapshot}
 */
export function makeSnapshot(blocks, meta = {}) {
  return {
    contractVersion: 1,
    documentId: meta.documentId ?? 'doc',
    revision: meta.revision ?? 0,
    settingsRevision: meta.settingsRevision ?? 0,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    blocks: blocks.map((b, i) => makeBlock(b, b.id ?? `b${i + 1}`)),
  };
}

/**
 * Paragraphs separated by blank lines; lines within a paragraph are joined with a space.
 * @param {string} text
 * @param {Parameters<typeof makeSnapshot>[1]} [meta]
 */
export function snapshotFromText(text, meta) {
  const paras = text
    .split(/\n\s*\n/u)
    .map((p) => p.split('\n').map((l) => l.trim()).join(' ').trim())
    .filter(Boolean);
  return makeSnapshot(paras.map((t) => ({ type: 'paragraph', text: t })), meta);
}

/**
 * Supports headings, bullet and numbered lists, blockquotes, fenced code,
 * paragraphs, and inline bold, italic, code, and links.
 * @param {string} md
 * @param {Parameters<typeof makeSnapshot>[1]} [meta]
 */
export function snapshotFromMarkdown(md, meta) {
  const lines = md.replace(/\r\n?/gu, '\n').split('\n');
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', ...parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i]);
      blocks.push({ type: 'codeBlock', text: code.join('\n'), marks: [] });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/u.exec(trimmed))) {
      flush();
      blocks.push({ type: 'heading', level: m[1].length, ...parseInline(m[2]) });
    } else if ((m = /^(?:[-*+]|\d+[.)])\s+(.*)$/u.exec(trimmed))) {
      flush();
      blocks.push({ type: 'listItem', ...parseInline(m[1]) });
    } else if ((m = /^>\s?(.*)$/u.exec(trimmed))) {
      flush();
      blocks.push({ type: 'blockquote', ...parseInline(m[1]) });
    } else {
      para.push(trimmed);
    }
  }
  flush();
  return makeSnapshot(blocks, meta);
}

/**
 * Strip inline Markdown and record marks against the stripped text.
 * @param {string} src
 * @returns {{ text: string, marks: Block['marks'] }}
 */
export function parseInline(src) {
  let text = '';
  /** @type {Block['marks']} */
  const marks = [];
  const open = { bold: -1, italic: -1 };
  for (let i = 0; i < src.length; ) {
    const rest = src.slice(i);
    let m;
    if (src[i] === '\\' && i + 1 < src.length) {
      text += src[i + 1];
      i += 2;
    } else if ((m = /^`([^`]+)`/u.exec(rest))) {
      marks.push({ from: text.length, to: text.length + m[1].length, type: 'code' });
      text += m[1];
      i += m[0].length;
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/u.exec(rest))) {
      marks.push({ from: text.length, to: text.length + m[1].length, type: 'link', href: m[2] });
      text += m[1];
      i += m[0].length;
    } else if (rest.startsWith('**') || rest.startsWith('__')) {
      toggle('bold');
      i += 2;
    } else if ((src[i] === '*' || src[i] === '_') && isEmphasisDelimiter(src, i)) {
      toggle('italic');
      i += 1;
    } else {
      text += src[i];
      i += 1;
    }
  }
  return { text, marks: marks.sort((a, b) => a.from - b.from || a.to - b.to) };

  /** @param {'bold'|'italic'} type */
  function toggle(type) {
    if (open[type] < 0) open[type] = text.length;
    else {
      if (text.length > open[type]) marks.push({ from: open[type], to: text.length, type });
      open[type] = -1;
    }
  }
}

// An underscore inside a word (snake_case) is literal text, not emphasis.
function isEmphasisDelimiter(src, i) {
  if (src[i] === '*') return true;
  const before = src[i - 1] ?? ' ';
  const after = src[i + 1] ?? ' ';
  return !(/\w/u.test(before) && /\w/u.test(after));
}
