// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../../src/editor/extensions.js';
import { findMatches, findState } from '../../src/editor/find.js';

let editor;
afterEach(() => editor?.destroy());
const make = (html) => (editor = new Editor({ extensions: editorExtensions({ onIssueClick: null }), content: html, injectCSS: false }));
const text = () => editor.getText();

describe('find and replace (plan §4.1)', () => {
  it('finds matches per textblock with case and whole-word options', () => {
    make('<p>The cat sat. the Cat scattered.</p><h2>Catalog</h2>');
    const q = (patch) => findMatches(editor.state.doc, { query: 'cat', caseSensitive: false, wholeWord: false, ...patch }).length;
    expect(q({})).toBe(4);
    expect(q({ caseSensitive: true })).toBe(2);
    expect(q({ wholeWord: true })).toBe(2);
    expect(q({ query: '' })).toBe(0);
    expect(q({ query: '.' })).toBe(2); // literal, not a regex
  });

  it('keeps matches current as the document changes and moves between them', () => {
    make('<p>aa ab aa</p>');
    editor.commands.setSearch({ query: 'aa' });
    expect(findState(editor.state).matches).toHaveLength(2);
    expect(findState(editor.state).active).toBe(0);
    editor.commands.findNext();
    expect(findState(editor.state).active).toBe(1);
    expect(editor.state.selection.from).toBe(7);
    editor.commands.findNext();
    expect(findState(editor.state).active).toBe(0);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' aa');
    expect(findState(editor.state).matches).toHaveLength(3);
  });

  it('replaces one match and then all, and one undo restores everything', () => {
    make('<p>red fish, red boat</p><p>red</p>');
    editor.commands.setSearch({ query: 'red' });
    editor.commands.replaceMatch('blue');
    expect(text()).toBe('blue fish, red boat\n\nred');
    expect(findState(editor.state).matches).toHaveLength(2);
    expect(findState(editor.state).active).toBe(0);
    editor.commands.replaceAllMatches('green');
    expect(text()).toBe('blue fish, green boat\n\ngreen');
    expect(findState(editor.state).matches).toHaveLength(0);
    editor.commands.undo();
    expect(text()).toBe('blue fish, red boat\n\nred');
    editor.commands.undo();
    expect(text()).toBe('red fish, red boat\n\nred');
    editor.commands.clearSearch();
    expect(findState(editor.state).matches).toHaveLength(0);
  });

  it('does not match across block boundaries', () => {
    make('<p>end</p><p>start</p>');
    expect(findMatches(editor.state.doc, { query: 'endstart', caseSensitive: false, wholeWord: false })).toEqual([]);
    expect(findMatches(editor.state.doc, { query: 'end', caseSensitive: false, wholeWord: false })).toEqual([{ from: 1, to: 4 }]);
  });
});
