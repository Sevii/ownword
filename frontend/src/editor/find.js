// Find and replace (improvement plan §4.1): a ProseMirror plugin that keeps
// the current query's matches as decorations and replaces one or all of
// them. Replace all is a single transaction, so one undo restores the text.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const findKey = new PluginKey('findReplace');

/** @typedef {{ query: string, caseSensitive: boolean, wholeWord: boolean }} Search */
/** @type {Search} */
export const EMPTY_SEARCH = { query: '', caseSensitive: false, wholeWord: false };

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Absolute ranges of every match, in document order. Text is matched within
 * each textblock, the same way checks and snapshots see it.
 * @param {import('@tiptap/pm/model').Node} doc
 * @param {Search} search
 * @returns {{ from: number, to: number }[]}
 */
export function findMatches(doc, search) {
  const q = search.query;
  if (!q) return [];
  const source = search.wholeWord ? `(?<![\\p{L}\\p{N}_])${escapeRegExp(q)}(?![\\p{L}\\p{N}_])` : escapeRegExp(q);
  const re = new RegExp(source, `gu${search.caseSensitive ? '' : 'i'}`);
  const matches = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    node.forEach((child) => { text += child.isText ? child.text : '￼'; });
    for (const m of text.matchAll(re)) {
      if (!m[0]) continue;
      matches.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    }
    return false;
  });
  return matches;
}

function decorate(doc, matches, active) {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === active ? 'find-match find-match--active' : 'find-match' })),
  );
}

/** The index of the first match at or after the selection, else 0. */
function nearest(matches, from) {
  const i = matches.findIndex((m) => m.from >= from);
  return i < 0 ? 0 : i;
}

export const FindReplace = Extension.create({
  name: 'findReplace',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => ({ search: EMPTY_SEARCH, matches: [], active: -1, decorations: DecorationSet.empty }),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey);
            if (!meta && !tr.docChanged) return prev;
            const search = meta?.search ?? prev.search;
            const matches = meta?.search || tr.docChanged ? findMatches(tr.doc, search) : prev.matches;
            let active;
            if (meta?.active !== undefined) active = meta.active;
            else if (meta?.search) active = matches.length ? nearest(matches, tr.selection.from) : -1;
            else active = matches.length ? Math.min(Math.max(prev.active, 0), matches.length - 1) : -1;
            return { search, matches, active, decorations: decorate(tr.doc, matches, active) };
          },
        },
        props: { decorations: (state) => findKey.getState(state).decorations },
      }),
    ];
  },
  addCommands() {
    return {
      /** @param {Partial<Search>} patch */
      setSearch: (patch) => ({ state, tr, dispatch }) => {
        const prev = findKey.getState(state).search;
        if (dispatch) tr.setMeta(findKey, { search: { ...prev, ...patch } });
        return true;
      },
      findNext: () => ({ state, tr, dispatch }) => move(state, tr, dispatch, 1),
      findPrevious: () => ({ state, tr, dispatch }) => move(state, tr, dispatch, -1),
      /** Replace the active match, then move to the next one. */
      replaceMatch: (text) => ({ state, tr, dispatch }) => {
        const { matches, active } = findKey.getState(state);
        const m = matches[active];
        if (!m) return false;
        if (dispatch) {
          tr.insertText(text, m.from, m.to);
          // After the edit, matches are recomputed; stay at the same index, which is now the next match.
          tr.setMeta(findKey, { active: Math.max(0, active) });
          tr.setSelection(TextSelection.create(tr.doc, m.from + text.length));
          tr.scrollIntoView();
        }
        return true;
      },
      /** Replace every match in one history step. */
      replaceAllMatches: (text) => ({ state, tr, dispatch }) => {
        const { matches } = findKey.getState(state);
        if (!matches.length) return false;
        if (dispatch) {
          for (const m of [...matches].reverse()) tr.insertText(text, m.from, m.to);
          tr.setMeta(findKey, { active: -1 });
        }
        return true;
      },
      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(findKey, { search: EMPTY_SEARCH, active: -1 });
        return true;
      },
    };
  },
});

function move(state, tr, dispatch, delta) {
  const { matches, active } = findKey.getState(state);
  if (!matches.length) return false;
  const next = active < 0 ? nearest(matches, state.selection.from) : (active + delta + matches.length) % matches.length;
  if (dispatch) {
    tr.setMeta(findKey, { active: next });
    tr.setSelection(TextSelection.create(tr.doc, matches[next].from, matches[next].to));
    tr.scrollIntoView();
  }
  return true;
}

/** @param {import('@tiptap/pm/state').EditorState} state */
export function findState(state) {
  return findKey.getState(state);
}
