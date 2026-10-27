// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions, ENSURE_BLOCK_IDS } from '../../src/editor/extensions.js';
import { snapshotFromDoc } from '../../src/editor/snapshot-from-editor.js';
import { applyEdits } from '../../src/editor/apply-edit.js';
import { buildScope, scopeBlocks } from '../../src/ai/scope.js';
import { parseModelJson, validateRewrite, findingsEnvelope, MAX_FINDINGS } from '../../src/ai/validate.js';
import { proposeRewrite, diffEdits } from '../../src/ai/rewrite.js';
import { wordDiff } from '../../src/analysis/edits/diff.js';
import { partialStrings, previewText } from '../../src/ai/preview.js';
import { reanchor } from '../../src/ai/reanchor.js';
import { validator } from '../helpers/contracts.js';

let editor;
afterEach(() => editor?.destroy());

function make(html) {
  editor = new Editor({ extensions: editorExtensions({ onIssueClick: null }), content: html, injectCSS: false });
  editor.view.dispatch(editor.state.tr.setMeta(ENSURE_BLOCK_IDS, true));
  return editor;
}
const meta = (revision = 1) => ({ documentId: 'd', revision, settingsRevision: 0 });
const snap = (revision = 1) => snapshotFromDoc(editor.state.doc, meta(revision));

describe('AI scope', () => {
  it('uses the touched blocks for a selection, with neighbors as context, and never rewrites code', () => {
    make('<p>One.</p><p>Two.</p><p>Three.</p><pre><code>x = 1</code></pre><p>Four.</p>');
    const { snapshot, positions } = snap();
    const [b1, b2, b3, code] = snapshot.blocks;
    const start = positions.get(b2.id);
    const sel = buildScope(snapshot, positions, { from: start + 1, to: start + 3 });
    expect(sel).toMatchObject({ kind: 'selection', editableBlockIds: [b2.id], contextBlockIds: [b1.id, b3.id], empty: false });
    const doc = buildScope(snapshot, positions, null);
    expect(doc.kind).toBe('document');
    expect(doc.editableBlockIds).not.toContain(code.id);
    expect(doc.contextBlockIds).toEqual([code.id]);
    expect(scopeBlocks(snapshot, sel).map((b) => b.id)).toEqual([b1.id, b2.id, b3.id]);
  });
  it('leaves out a block the selection only reaches the edge of', () => {
    make('<p>One.</p><p>Two.</p><p>Three.</p>');
    const { snapshot, positions } = snap();
    const [b1, b2, b3] = snapshot.blocks;
    // From inside One. to the very start of Two. (a drag or Shift+Down to the next line).
    const toEdge = buildScope(snapshot, positions, { from: positions.get(b1.id) + 1, to: positions.get(b2.id) });
    expect(toEdge.editableBlockIds).toEqual([b1.id]);
    // From the very end of One. into Two.
    const fromEdge = buildScope(snapshot, positions, { from: positions.get(b1.id) + b1.text.length, to: positions.get(b2.id) + 2 });
    expect(fromEdge.editableBlockIds).toEqual([b2.id]);
    expect(fromEdge.contextBlockIds).toEqual([b1.id, b3.id]);
  });
});

describe('AI output validation', () => {
  it('parses JSON with or without a code fence, and rejects anything else', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('{"a":')).toBeNull();
    expect(parseModelJson('[1]')).toBeNull();
  });

  it('accepts a rewrite only when it covers exactly the editable blocks', () => {
    make('<p>Teh plan.</p><p>Second.</p>');
    const { snapshot } = snap();
    const [a, b] = snapshot.blocks.map((x) => x.id);
    const ctx = { snapshot, editableBlockIds: [a, b] };
    expect(validateRewrite({ blocks: [{ id: b, text: 'Second.' }, { id: a, text: 'The\nplan.' }] }, ctx)).toEqual({
      ok: true,
      blocks: [{ id: a, text: 'The plan.' }, { id: b, text: 'Second.' }],
    });
    expect(validateRewrite({ blocks: [{ id: a, text: 'x' }] }, ctx)).toMatchObject({ ok: false, message: expect.stringContaining('left out') });
    expect(validateRewrite({ blocks: [{ id: a, text: 'x' }, { id: b, text: 'y' }, { id: 'zz', text: 'z' }] }, ctx).ok).toBe(false);
    expect(validateRewrite({ blocks: [{ id: a, text: 'x' }, { id: a, text: 'x' }] }, ctx).ok).toBe(false);
    expect(validateRewrite({ blocks: [{ id: a, text: '' }, { id: b, text: 'y' }] }, ctx).ok).toBe(false);
    expect(validateRewrite({ blocks: [{ id: a, text: 'a b' }, { id: b, text: 'y' }] }, ctx).ok).toBe(false);
    expect(validateRewrite({ nope: 1 }, ctx).ok).toBe(false);
  });

  it('anchors findings by exact quote, discards the rest, and produces contract-valid issues', () => {
    make('<p>Teh plan and the the launch.</p><p>Context only.</p>');
    const { snapshot } = snap();
    const [a, ctxBlock] = snapshot.blocks.map((x) => x.id);
    const out = {
      summary: 'Two mistakes.',
      findings: [
        { category: 'spelling', severity: 'error', evidence: [{ blockId: a, quote: 'Teh' }], rationale: 'Misspelled.', replacement: 'The' },
        { category: 'repetition', severity: 'error', evidence: [{ blockId: a, quote: 'the the' }], rationale: 'Repeated.', replacement: 'the' },
        { category: 'grammar', severity: 'error', evidence: [{ blockId: a, quote: 'not here' }], rationale: 'x' },
        { category: 'tone', severity: 'suggestion', evidence: [{ blockId: ctxBlock, quote: 'Context' }], rationale: 'out of scope' },
        { category: 'made-up', severity: 'suggestion', evidence: [{ blockId: a, quote: 'plan' }], rationale: 'odd category' },
      ],
    };
    const r = findingsEnvelope(out, {
      snapshot, editableBlockIds: [a], contextBlockIds: [ctxBlock], scopeKind: 'selection', requestId: 'req-1',
      action: 'proofread', provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', promptVersion: 'prompts-3',
    });
    expect(r.ok).toBe(true);
    const env = r.envelope;
    expect(env.findings.map((f) => f.anchor.expectedText)).toEqual(['Teh', 'the the', 'plan']);
    expect(env.findings[2].category).toBe('other');
    expect(env.rejectedFindingCount).toBe(2);
    expect(env.coverage.limitations[0]).toMatch(/2 findings failed validation/u);
    expect(env.summary).toBe('Two mistakes.');
    for (const f of env.findings) expect(validator('issue')(f).errors).toEqual([]);
    expect(validator('envelope')(env).errors).toEqual([]);
    expect(env.findings[0]).toMatchObject({ classification: 'likely-error', replacements: [{ text: 'The' }], origin: { kind: 'ai', promptVersion: 'prompts-3' } });
  });

  it('fails a review whose findings all fail validation, and caps the count', () => {
    make('<p>Text.</p>');
    const { snapshot } = snap();
    const id = snapshot.blocks[0].id;
    const ctx = { snapshot, editableBlockIds: [id], contextBlockIds: [], scopeKind: 'document', requestId: 'r', action: 'proofread', provider: 'p', model: 'm' };
    expect(findingsEnvelope({ findings: [{ evidence: [{ blockId: id, quote: 'nope' }] }] }, ctx)).toMatchObject({ ok: false });
    expect(findingsEnvelope({ findings: [] }, ctx)).toMatchObject({ ok: true });
    const many = { findings: Array.from({ length: 25 }, () => ({ evidence: [{ blockId: id, quote: 'Text' }], rationale: 'x' })) };
    const r = findingsEnvelope(many, ctx);
    expect(r.envelope.findings.length).toBeLessThanOrEqual(MAX_FINDINGS);
    expect(r.envelope.coverage.limitations[0]).toMatch(/first 20/u);
  });
});

describe('rewrite proposals', () => {
  it('turns a word diff into minimal edits', () => {
    const before = 'Teh invoice will not arrive.';
    const edits = diffEdits('b', before, wordDiff(before, 'The invoice will not arrive today.'));
    expect(edits).toEqual([
      { blockId: 'b', from: 0, to: 3, expectedText: 'Teh', text: 'The' },
      { blockId: 'b', from: 27, to: 27, expectedText: '', text: ' today' },
    ]);
  });

  it('flags meaning changes, keeps formatting by editing only changed words, and applies in one undo step', () => {
    make('<p>Teh <strong>invoice</strong> for $1,200 will not arrive.</p><p>Fine as is.</p>');
    const { snapshot } = snap();
    const [a, b] = snapshot.blocks.map((x) => x.id);
    const proposal = proposeRewrite(snapshot, [
      { id: a, text: 'The invoice for $1,500 will arrive.' },
      { id: b, text: 'Fine as is.' },
    ]);
    expect(proposal.unchanged).toBe(1);
    const [c] = proposal.changes;
    expect(c.problem).toBeNull();
    expect(c.meaning.removed.map((s) => s.text)).toEqual(expect.arrayContaining(['$1,200', 'not']));
    expect(c.meaning.added.map((s) => s.text)).toEqual(['$1,500']);
    expect(applyEdits(editor, meta(), proposal.edits)).toEqual({ ok: true });
    expect(editor.getHTML()).toContain('The <strong>invoice</strong> for $1,500 will arrive.');
    editor.commands.undo();
    expect(editor.getHTML()).toContain('Teh <strong>invoice</strong> for $1,200 will not arrive.');
  });

  it('leaves out a block whose change would split formatting, and applies nothing if the text changed', () => {
    // "now, please" -> "kindly" is one change that starts inside the bold and ends outside it.
    make('<p>Ask <strong>now</strong>, please.</p><p>Plain teh text.</p>');
    const { snapshot } = snap();
    const [a, b] = snapshot.blocks.map((x) => x.id);
    const proposal = proposeRewrite(snapshot, [
      { id: a, text: 'Ask kindly.' },
      { id: b, text: 'Plain the text.' },
    ]);
    expect(proposal.changes[0].problem).toMatch(/formatting/u);
    expect(proposal.changes[1].problem).toBeNull();
    expect(proposal.edits.every((e) => e.blockId === b)).toBe(true);

    // Typing inside "teh" after the request: the edit no longer matches, so nothing applies.
    const start = snap().positions.get(b);
    editor.commands.insertContentAt(start + 7, 'X');
    expect(applyEdits(editor, meta(2), proposal.edits)).toMatchObject({ ok: false, reason: 'text-mismatch' });
    expect(editor.getText()).toContain('tXeh');
  });
});

describe('streaming preview and re-anchoring', () => {
  it('reads string values out of partial JSON', () => {
    const partial = '{"blocks":[{"id":"a","text":"Hello \\"you\\"\\n"},{"id":"b","text":"Half wr';
    expect(partialStrings(partial, 'text')).toEqual(['Hello "you" ', 'Half wr']);
    expect(previewText('rewrite', partial)).toBe('Hello "you" \n\nHalf wr');
    expect(previewText('findings', '{"findings":[{"evidence":[{"quote":"x"}]}')).toMatch(/1 thing/u);
  });

  it('re-anchors AI findings through edits, by mapped position or a unique quote, and drops the rest', () => {
    make('<p>Teh plan, recieved today.</p>');
    const { snapshot: s1, positions: p1 } = snap(1);
    const id = s1.blocks[0].id;
    const start = p1.get(id);
    const mk = (quote, from, n) => ({ id: `ai:r:${n}`, anchor: { blockId: id, from, to: from + quote.length, expectedText: quote }, sourceRevision: 1 });
    const issues = [mk('Teh', 0, 0), mk('recieved', 10, 1)];
    editor.commands.insertContentAt(start, 'So ');
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Teh end.');
    const { snapshot: s2, positions: p2 } = snap(2);
    // Mapped ranges (as the app keeps them): the first Teh moved by 3.
    const ranges = new Map([['ai:r:0', { from: start + 3, to: start + 6 }]]);
    const out = reanchor(issues, s2, p2, ranges);
    expect(out.map((i) => [i.id, i.anchor.from, i.anchor.expectedText])).toEqual([['ai:r:0', 3, 'Teh'], ['ai:r:1', 13, 'recieved']]);
    expect(out[0].sourceRevision).toBe(2);
    // Without a mapped range, "Teh" is now ambiguous, so it is dropped.
    expect(reanchor(issues, s2, p2, null).map((i) => i.id)).toEqual(['ai:r:1']);
  });

  it('keeps a finding on a repeated word at its own anchor in the text it was made from', () => {
    make('<p>its fine, and its late.</p>');
    const { snapshot: s1, positions: p1 } = snap(1);
    const id = s1.blocks[0].id;
    // Validation placed the second "its" by its context; only the anchor is kept.
    const issue = { id: 'ai:r:0', documentId: 'd', sourceRevision: 1, anchor: { blockId: id, from: 14, to: 17, expectedText: 'its' } };
    expect(reanchor([issue], s1, p1, null).map((i) => i.anchor.from)).toEqual([14]);
    // A wrong anchor is not trusted, and another document's revision 1 is not this one.
    expect(reanchor([{ ...issue, anchor: { ...issue.anchor, from: 13, to: 16 } }], s1, p1, null)).toEqual([]);
    expect(reanchor([{ ...issue, documentId: 'other' }], s1, p1, null)).toEqual([]);
  });
});
