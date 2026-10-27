// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions, ENSURE_BLOCK_IDS, issueRanges, mapIssueRanges } from '../../src/editor/extensions.js';
import { snapshotFromDoc } from '../../src/editor/snapshot-from-editor.js';
import { applyReplacement } from '../../src/editor/apply-edit.js';
import { sanitizePastedHtml, sanitizeDocJson } from '../../src/editor/sanitize.js';
import { analyze } from '../../src/analysis/pipeline.js';
import { createRulesEngine } from '../../src/analysis/rules/index.js';
import { validator } from '../helpers/contracts.js';

let editor;
afterEach(() => editor?.destroy());

function make(html) {
  editor = new Editor({ extensions: editorExtensions({ onIssueClick: null }), content: html, injectCSS: false });
  editor.view.dispatch(editor.state.tr.setMeta(ENSURE_BLOCK_IDS, true));
  return editor;
}

const meta = (revision = 1) => ({ documentId: 'd', revision, settingsRevision: 0 });

describe('editor snapshot', () => {
  it('assigns unique block IDs and keeps them unique after a split', () => {
    make('<p>One</p><p>Two</p>');
    const ids = () => snapshotFromDoc(editor.state.doc, meta()).snapshot.blocks.map((b) => b.id);
    const before = ids();
    expect(new Set(before).size).toBe(2);
    expect(before.every((id) => id.startsWith('b-'))).toBe(true);
    editor.commands.setTextSelection(3);
    editor.commands.splitBlock();
    const after = ids();
    expect(after.length).toBe(3);
    expect(new Set(after).size).toBe(3);
    expect(after[0]).toBe(before[0]);
  });

  it('reassigns duplicated IDs from pasted or saved HTML', () => {
    make('<p data-block-id="b-same">A</p><p data-block-id="b-same">B</p>');
    const ids = snapshotFromDoc(editor.state.doc, meta()).snapshot.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('produces a contract-valid snapshot with types, marks, and exact positions', () => {
    make('<h2>Title</h2><p>A😀 <strong>teh</strong> <a href="https://x.y">link</a></p><ul><li><p>item</p></li></ul><blockquote><p>q</p></blockquote>');
    const { snapshot, positions } = snapshotFromDoc(editor.state.doc, meta());
    expect(validator('snapshot')(snapshot).errors).toEqual([]);
    // The trailing-node extension adds an empty paragraph after a final blockquote.
    expect(snapshot.blocks.map((b) => [b.type, b.text])).toEqual([
      ['heading', 'Title'], ['paragraph', 'A😀 teh link'], ['listItem', 'item'], ['blockquote', 'q'], ['paragraph', ''],
    ]);
    const p = snapshot.blocks[1];
    expect(p.marks).toEqual([{ from: 4, to: 7, type: 'bold' }, { from: 8, to: 12, type: 'link', href: 'https://x.y' }]);
    const start = positions.get(p.id);
    expect(editor.state.doc.textBetween(start + 4, start + 7)).toBe('teh');
  });
});

describe('issue ranges', () => {
  it('follow the text through edits and drop when their text is deleted', () => {
    make('<p>in order to go</p><p>teh end</p>');
    const { snapshot, positions } = snapshotFromDoc(editor.state.doc, meta());
    const [p1, p2] = snapshot.blocks.map((b) => b.id);
    const issues = [
      { id: 'phrase', anchor: { blockId: p1, from: 0, to: 11 } },
      { id: 'teh', anchor: { blockId: p2, from: 0, to: 3 } },
      { id: 'gap', anchor: { blockId: p2, from: 7, to: 7 } },
    ];
    let ranges = issueRanges(issues, positions);
    const text = (id) => editor.state.doc.textBetween(ranges.get(id).from, ranges.get(id).to);
    expect(text('teh')).toBe('teh');

    // Deleting the phrase shortens paragraph 1; later ranges move with their text.
    const r = ranges.get('phrase');
    const tr = editor.state.tr.delete(r.from, r.to + 1);
    editor.view.dispatch(tr);
    ranges = mapIssueRanges(ranges, tr.mapping);
    expect(ranges.has('phrase')).toBe(false);
    expect(text('teh')).toBe('teh');
    expect(editor.state.doc.textBetween(ranges.get('gap').from - 3, ranges.get('gap').from)).toBe('end');
  });
});

describe('applyReplacement', () => {
  /** A finding on `word`, or an insertion point `insertAt` characters into it. */
  async function issueFor(word, insertAt = null) {
    const { snapshot } = snapshotFromDoc(editor.state.doc, meta());
    const engine = {
      name: 'test', version: '1', setup: async () => {},
      run: async (snap) => {
        const b = snap.blocks.find((x) => x.text.includes(word));
        const start = b.text.indexOf(word);
        const [from, to] = insertAt === null ? [start, start + word.length] : [start + insertAt, start + insertAt];
        return { findings: [{ blockId: b.id, from, to, ruleId: 't', category: 'spelling', classification: 'likely-error', message: 'm' }], rejected: 0 };
      },
    };
    return (await analyze(snapshot, {}, { engines: [engine], requestId: 'r' })).envelope.findings[0];
  }

  it('replaces inside bold after an emoji, keeps the mark, and undoes in one step', async () => {
    make('<p>A😀 <strong>teh</strong> plan</p>');
    const issue = await issueFor('teh');
    expect(applyReplacement(editor, meta(), issue, 'the')).toEqual({ ok: true });
    expect(editor.getHTML()).toContain('A😀 <strong>the</strong> plan');
    editor.commands.undo();
    expect(editor.getHTML()).toContain('A😀 <strong>teh</strong> plan');
  });

  it('does not let an insertion next to bold become bold', async () => {
    make('<p><strong>Bold</strong>teh x</p>');
    const issue = await issueFor('teh');
    applyReplacement(editor, meta(), issue, 'the');
    expect(editor.getHTML()).toContain('<strong>Bold</strong>the x');
  });

  it('keeps formatting on text inserted inside bold, but not at its edge', async () => {
    make('<p>A <strong>big dog</strong> ran</p>');
    applyReplacement(editor, meta(), await issueFor('big dog', 3), ',');
    expect(editor.getHTML()).toContain('A <strong>big, dog</strong> ran');
    make('<p><strong>Bold</strong> x</p>');
    applyReplacement(editor, meta(), await issueFor('Bold', 4), '!');
    expect(editor.getHTML()).toContain('<strong>Bold</strong>! x');
  });

  it('refuses stale revisions and changed text', async () => {
    make('<p>teh plan</p>');
    const issue = await issueFor('teh');
    expect(applyReplacement(editor, meta(2), issue, 'the')).toEqual({ ok: false, reason: 'stale' });
    editor.commands.insertContentAt(1, 'x');
    expect(applyReplacement(editor, meta(1), issue, 'the')).toMatchObject({ ok: false });
    expect(editor.getText()).toBe('xteh plan');
  });

  it('works with the real rules engine end to end', async () => {
    make('<p>In order to ship, we wait.</p>');
    const { snapshot } = snapshotFromDoc(editor.state.doc, meta());
    const { envelope } = await analyze(snapshot, {}, { engines: [createRulesEngine()], requestId: 'r' });
    const issue = envelope.findings.find((f) => f.origin.ruleId === 'style.redundant-phrase');
    expect(applyReplacement(editor, meta(), issue, issue.replacements[0].text)).toEqual({ ok: true });
    expect(editor.getText()).toBe('To ship, we wait.');
  });
});

describe('sanitization', () => {
  it('gives pasted copies of a block a fresh ID instead of taking the original’s', () => {
    make('<p>Intro</p><p>Original</p>');
    const id = (text) => snapshotFromDoc(editor.state.doc, meta()).snapshot.blocks.find((b) => b.text === text)?.id;
    // Paste a copy of both paragraphs at the start of the document.
    const copied = editor.getHTML();
    editor.commands.setContent('<p></p>' + copied);
    editor.view.dispatch(editor.state.tr.setMeta(ENSURE_BLOCK_IDS, true));
    const before = id('Original');
    editor.commands.setTextSelection(1);
    editor.view.pasteHTML(copied);
    const blocks = snapshotFromDoc(editor.state.doc, meta()).snapshot.blocks;
    expect(blocks.filter((b) => b.text === 'Original').length).toBe(2);
    expect(blocks.filter((b) => b.text === 'Original').at(-1).id).toBe(before);
  });

  it('strips scripts, handlers, styles, and unsafe links from pasted HTML', () => {
    const out = sanitizePastedHtml('<p onclick="x()" style="color:red">Hi <a href="javascript:alert(1)">bad</a> <a href="https://ok.example">ok</a><script>alert(1)</script><img src=x onerror=alert(1)></p>');
    expect(out).not.toMatch(/script|onclick|onerror|style=|javascript:|src=/u);
    expect(out).toContain('<a href="https://ok.example">ok</a>');
    expect(out).toContain('bad');
  });

  it('drops unsafe link marks from pasted content and saved JSON', () => {
    make('<p>x</p>');
    editor.commands.setContent(sanitizePastedHtml('<p><a href="javascript:alert(1)">click</a> <a href="data:text/html,x">d</a></p>'));
    expect(editor.getHTML()).not.toMatch(/javascript:|data:/u);
    const json = sanitizeDocJson({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:1' } }] }] }] });
    expect(json.content[0].content[0].marks).toEqual([]);
  });
});
