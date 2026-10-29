// Convert stored editor content (ProseMirror JSON) to and from the analysis
// snapshot and Markdown without an editor instance, for library export and
// import and for folder sync (improvement plan §3). Front matter carries the
// document's identity so a file can be matched to its record again.

import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { editorExtensions } from '../editor/extensions.js';
import { snapshotFromDoc } from '../editor/snapshot-from-editor.js';
import { snapshotFromMarkdown } from '../analysis/snapshot/from-markdown.js';
import { toMarkdown } from './export.js';

let schema = null;
function editorSchema() {
  schema ??= getSchema(editorExtensions({ onIssueClick: null }));
  return schema;
}

/**
 * @param {object} content stored ProseMirror JSON
 * @param {{ documentId?: string }} [meta]
 * @returns {import('../analysis/types.js').Snapshot}
 */
export function snapshotFromContent(content, meta = {}) {
  const doc = Node.fromJSON(editorSchema(), content);
  return snapshotFromDoc(doc, { documentId: meta.documentId ?? 'doc', revision: 0, settingsRevision: 0 }).snapshot;
}

/** Inline text runs for a block, splitting at every mark boundary. */
function inlineNodes(block) {
  const text = block.text;
  if (!text) return [];
  const cuts = new Set([0, text.length]);
  for (const m of block.marks) {
    cuts.add(m.from);
    cuts.add(m.to);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const nodes = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [from, to] = [points[i], points[i + 1]];
    const marks = block.marks
      .filter((m) => m.from <= from && to <= m.to)
      .map((m) => (m.type === 'link' ? { type: 'link', attrs: { href: m.href } } : { type: m.type }));
    nodes.push({ type: 'text', text: text.slice(from, to), ...(marks.length ? { marks } : {}) });
  }
  return nodes;
}

/**
 * Build editor content from a snapshot. Consecutive list items become one
 * bullet list (snapshots do not record list kind).
 * @param {import('../analysis/types.js').Snapshot} snapshot
 */
export function contentFromSnapshot(snapshot) {
  const out = [];
  let list = null;
  for (const b of snapshot.blocks) {
    if (b.type === 'listItem') {
      list ??= { type: 'bulletList', content: [] };
      list.content.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineNodes(b) }] });
      continue;
    }
    if (list) {
      out.push(list);
      list = null;
    }
    if (b.type === 'codeBlock') out.push({ type: 'codeBlock', content: b.text ? [{ type: 'text', text: b.text }] : [] });
    else if (b.type === 'heading') out.push({ type: 'heading', attrs: { level: b.level ?? 1 }, content: inlineNodes(b) });
    else if (b.type === 'blockquote') out.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inlineNodes(b) }] });
    else out.push({ type: 'paragraph', content: inlineNodes(b) });
  }
  if (list) out.push(list);
  return { type: 'doc', content: out.length ? out : [{ type: 'paragraph' }] };
}

/** @param {string} markdown */
export function contentFromMarkdown(markdown) {
  return contentFromSnapshot(snapshotFromMarkdown(markdown));
}

/** @param {object} content */
export function markdownFromContent(content) {
  return toMarkdown(snapshotFromContent(content));
}

/**
 * A Markdown file with front matter that names the document.
 * @param {{ id: string, title: string, createdAt: number, updatedAt: number, goals?: object }} doc
 * @param {string} markdown
 */
export function withFrontMatter(doc, markdown) {
  const lines = [
    '---',
    `id: ${doc.id}`,
    `title: ${JSON.stringify(doc.title ?? '')}`,
    `created: ${new Date(doc.createdAt).toISOString()}`,
    `updated: ${new Date(doc.updatedAt).toISOString()}`,
    ...(doc.goals && Object.keys(doc.goals).length ? [`goals: ${JSON.stringify(doc.goals)}`] : []),
    '---',
    '',
  ];
  return lines.join('\n') + markdown;
}

/**
 * Split front matter from a Markdown file. Unknown keys are kept as strings.
 * @param {string} text
 * @returns {{ meta: { id?: string, title?: string, createdAt?: number, updatedAt?: number, goals?: object }, body: string }}
 */
export function parseFrontMatter(text) {
  const src = text.replace(/^﻿/u, '').replace(/\r\n?/gu, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/u.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/u.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw.trim();
    const parsed = (() => {
      if (/^".*"$/u.test(value) || /^[[{]/u.test(value)) {
        try { return JSON.parse(value); } catch { return value; }
      }
      return value;
    })();
    if (key === 'id' && typeof parsed === 'string' && /^[\w-]{1,64}$/u.test(parsed)) meta.id = parsed;
    else if (key === 'title' && typeof parsed === 'string') meta.title = parsed;
    else if (key === 'created' || key === 'updated') {
      const t = Date.parse(String(parsed));
      if (!Number.isNaN(t)) meta[key === 'created' ? 'createdAt' : 'updatedAt'] = t;
    } else if (key === 'goals' && parsed && typeof parsed === 'object') meta.goals = parsed;
  }
  return { meta, body: src.slice(m[0].length) };
}

/** A document title from a file name. @param {string} name */
export function titleFromFilename(name) {
  return name.replace(/\.(md|markdown|txt|docx)$/iu, '').replace(/[-_]+/gu, ' ').trim() || 'Untitled';
}
