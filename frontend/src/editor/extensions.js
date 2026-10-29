// The limited editor schema, stable block IDs, and issue decorations.

import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isAllowedHref, sanitizePastedHtml } from './sanitize.js';
import { FindReplace } from './find.js';

const TEXTBLOCKS = ['paragraph', 'heading', 'codeBlock'];

export function newBlockId() {
  return `b-${crypto.randomUUID().slice(0, 8)}`;
}

const blockIdKey = new PluginKey('blockIds');
export const ENSURE_BLOCK_IDS = 'ow:ensureBlockIds';

/**
 * Every textblock carries a unique, persistent `blockId`. Splits, pastes,
 * and duplicates get fresh IDs (docs/proofreading-design.md §5).
 */
export const BlockIds = Extension.create({
  name: 'blockIds',
  addGlobalAttributes() {
    return [
      {
        types: TEXTBLOCKS,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute('data-block-id'),
            renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdKey,
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged || t.getMeta(ENSURE_BLOCK_IDS))) return null;
          let tr = null;
          const seen = new Set();
          state.doc.descendants((node, pos) => {
            if (!node.isTextblock) return true;
            const id = node.attrs.blockId;
            if (!id || seen.has(id)) {
              tr ??= state.tr;
              const fresh = newBlockId();
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: fresh });
              seen.add(fresh);
            } else {
              seen.add(id);
            }
            return false;
          });
          if (tr) tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
});

export const issueKey = new PluginKey('issues');

/**
 * Renders issues as decorations without touching document content. Set with
 * a transaction carrying { decorations } under issueKey; otherwise existing
 * decorations are mapped through edits for display only (applicability is
 * always rechecked against a fresh snapshot).
 */
export const IssueDecorations = Extension.create({
  name: 'issueDecorations',
  addOptions() {
    return { onIssueClick: /** @type {null | ((id: string, el: Element | null) => void)} */ (null) };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: issueKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(issueKey);
            if (meta) return DecorationSet.create(tr.doc, meta.decorations);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => issueKey.getState(state),
          handleClick(view, pos, event) {
            const found = issueKey.getState(view.state).find(pos, pos);
            const hit = found.find((d) => d.from <= pos && pos <= d.to);
            const el = event.target instanceof Element ? event.target.closest('[data-issue-id]') : null;
            if (hit && options.onIssueClick) options.onIssueClick(hit.spec.issueId, el);
            return false;
          },
        },
      }),
    ];
  },
});

/**
 * Absolute document ranges for issues, from the block start positions of the
 * snapshot that produced them. Keep them current with mapIssueRanges.
 * @param {import('../analysis/types.js').Issue[]} issues
 * @param {Map<string, number>} positions block ID -> content start position
 * @returns {Map<string, { from: number, to: number }>}
 */
export function issueRanges(issues, positions) {
  const ranges = new Map();
  for (const issue of issues) {
    const a = issue.anchor;
    const start = a && positions.get(a.blockId);
    if (start === undefined || start === null) continue;
    ranges.set(issue.id, { from: start + a.from, to: start + a.to });
  }
  return ranges;
}

/**
 * Move issue ranges through an edit. A range whose text was deleted, or an
 * insertion point inside deleted text, is dropped.
 * @param {Map<string, { from: number, to: number }>} ranges
 * @param {import('@tiptap/pm/transform').Mappable} mapping
 */
export function mapIssueRanges(ranges, mapping) {
  const out = new Map();
  for (const [id, r] of ranges) {
    if (r.from === r.to) {
      const m = mapping.mapResult(r.from, 1);
      if (!m.deleted) out.set(id, { from: m.pos, to: m.pos });
      continue;
    }
    const from = mapping.map(r.from, 1);
    const to = mapping.map(r.to, -1);
    if (from < to) out.set(id, { from, to });
  }
  return out;
}

/**
 * Build decorations for issues at their current ranges.
 * @param {import('../analysis/types.js').Issue[]} issues
 * @param {Map<string, { from: number, to: number }>} ranges from issueRanges / mapIssueRanges
 * @param {string | null} activeId
 */
export function issueDecorations(issues, ranges, activeId) {
  const decos = [];
  for (const issue of issues) {
    const r = ranges.get(issue.id);
    if (!r) continue;
    const cls = [
      'issue',
      issue.classification === 'likely-error' ? 'issue--error' : 'issue--style',
      issue.id === activeId ? 'issue--active' : '',
    ].join(' ');
    const spec = { issueId: issue.id, inclusiveStart: false, inclusiveEnd: false };
    if (r.from === r.to) {
      decos.push(Decoration.widget(r.from, () => insertionMark(cls, issue.id), { ...spec, side: 1, key: issue.id }));
    } else {
      decos.push(Decoration.inline(r.from, r.to, { class: cls, 'data-issue-id': issue.id }, spec));
    }
  }
  return decos;
}

function insertionMark(cls, id) {
  const el = document.createElement('span');
  el.className = `${cls} issue--insert`;
  el.setAttribute('data-issue-id', id);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function editorExtensions({ onIssueClick }) {
  return [
    StarterKit.configure({
      strike: false,
      underline: false,
      horizontalRule: false,
      hardBreak: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => isAllowedHref(url),
        shouldAutoLink: (url) => isAllowedHref(url.includes(':') ? url : `https://${url}`),
      },
    }),
    BlockIds,
    IssueDecorations.configure({ onIssueClick }),
    FindReplace,
    Extension.create({
      name: 'pasteSanitizer',
      addProseMirrorPlugins() {
        return [new Plugin({ props: { transformPastedHTML: sanitizePastedHtml } })];
      },
    }),
  ];
}
