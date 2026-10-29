import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { contentFromMarkdown, markdownFromContent, snapshotFromContent, contentFromSnapshot, withFrontMatter, parseFrontMatter, titleFromFilename } from '../../src/documents/content.js';
import { buildLibrary, readLibrary, mergeDocuments, mergePrefs, documentFromFile } from '../../src/documents/library.js';
import { snapshotFromMarkdown } from '../../src/analysis/snapshot/from-markdown.js';

const md = '# Plan\n\nShip **bold** and *it* with [a link](https://x.y) and `code`.\n\n- one\n- two\n\n> quote\n\n```\nlet x = 1\n```\n';

describe('content conversion without an editor (plan §3)', () => {
  it('round-trips the Markdown subset through editor content', () => {
    const content = contentFromMarkdown(md);
    expect(content.content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'bulletList', 'blockquote', 'codeBlock']);
    expect(content.content[2].content).toHaveLength(2);
    expect(markdownFromContent(content)).toBe(md);
    const back = snapshotFromContent(content);
    expect(back.blocks.map((b) => [b.type, b.text, b.marks])).toEqual(snapshotFromMarkdown(md).blocks.map((b) => [b.type, b.text, b.marks]));
  });

  it('splits text at overlapping mark boundaries and keeps link targets', () => {
    const snap = snapshotFromMarkdown('a **b [c](https://x.y/z) d** e');
    const para = contentFromSnapshot(snap).content[0];
    expect(para.content.map((t) => t.text)).toEqual(['a ', 'b ', 'c', ' d', ' e']);
    expect(para.content[2].marks).toEqual(expect.arrayContaining([{ type: 'bold' }, { type: 'link', attrs: { href: 'https://x.y/z' } }]));
    expect(contentFromSnapshot(snapshotFromMarkdown(''))).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('writes and reads front matter, ignoring what it does not know', () => {
    const doc = { id: 'abc-123', title: 'Q3 "plan": draft', createdAt: 1700000000000, updatedAt: 1700000600000, goals: { formality: 'formal' } };
    const text = withFrontMatter(doc, 'Body\n');
    expect(text.startsWith('---\nid: abc-123\ntitle: "Q3 \\"plan\\": draft"\n')).toBe(true);
    const { meta, body } = parseFrontMatter(`${text.slice(0, -1)}\n`.replace('---\nBody', 'tags: [x]\nweird\n---\nBody'));
    expect(meta).toEqual({ id: 'abc-123', title: 'Q3 "plan": draft', createdAt: 1700000000000, updatedAt: 1700000600000, goals: { formality: 'formal' } });
    expect(body).toBe('Body\n');
    expect(parseFrontMatter('No front matter\n')).toEqual({ meta: {}, body: 'No front matter\n' });
    expect(parseFrontMatter('---\nid: ../../etc\n---\nx')).toEqual({ meta: {}, body: 'x' });
    expect(titleFromFilename('my_trip-notes.md')).toBe('my trip notes');
  });
});

describe('library zip (plan §3.1)', () => {
  const docs = [
    { id: 'd1', title: 'Plan', content: contentFromMarkdown(md), createdAt: 1, updatedAt: 10, goals: { formality: 'casual' } },
    { id: 'd2', title: 'Plan', content: contentFromMarkdown('Second doc.\n'), createdAt: 2, updatedAt: 20, goals: {} },
  ];
  const prefs = { dialect: 'en-GB', dictionary: ['Quux'], disabledRules: ['harper.X'], longSentenceWords: 25, paused: true };

  it('writes one Markdown file per document plus a manifest, and never a key', () => {
    const zip = buildLibrary({ documents: docs, prefs: { ...prefs, aiConnections: { key: 'sk-secret' } }, dismissals: [{ a: 1 }] });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'documents/Plan-d2.md', 'documents/Plan.md', 'library.json']);
    const plan = strFromU8(files['documents/Plan.md']);
    expect(plan).toContain('id: d1');
    expect(plan).toContain(md);
    const manifest = JSON.parse(strFromU8(files['library.json']));
    expect(manifest.prefs).toEqual({ dialect: 'en-GB', dictionary: ['Quux'], disabledRules: ['harper.X'], longSentenceWords: 25 });
    expect(manifest.documents.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(JSON.stringify(manifest)).not.toContain('sk-secret');
  });

  it('reads its own zip exactly, and a zip of Markdown files by front matter or file name', () => {
    const read = readLibrary(buildLibrary({ documents: docs, prefs, dismissals: [] }), 'lib.zip');
    expect(read.documents).toEqual(docs);
    expect(read.prefs.dictionary).toEqual(['Quux']);

    const { zipSync, strToU8 } = require('fflate');
    const loose = zipSync({ 'notes/trip-notes.md': strToU8('# Trip\n\nGo.\n'), 'notes/.hidden.md': strToU8('x'), 'img.png': new Uint8Array(3) });
    const fromFiles = readLibrary(loose, 'notes.zip');
    expect(fromFiles.documents).toHaveLength(1);
    expect(fromFiles.documents[0]).toMatchObject({ title: 'trip notes', goals: {} });
    expect(fromFiles.documents[0].id).toBeUndefined();
    expect(markdownFromContent(fromFiles.documents[0].content)).toBe('# Trip\n\nGo.\n');
    expect(() => readLibrary(zipSync({ 'a.png': new Uint8Array(1) }), 'x.zip')).toThrow(/No Markdown/u);
  });

  it('reads a single Markdown or text file', () => {
    const one = readLibrary(new TextEncoder().encode('---\nid: k9\ntitle: "Hi"\n---\nHello *there*.\n'), 'hi.md');
    expect(one.documents[0]).toMatchObject({ id: 'k9', title: 'Hi' });
    const txt = documentFromFile('todo.txt', 'a\n  b\n');
    expect(txt.content).toBeNull();
    expect(txt.text).toBe('a\n  b\n');
  });

  it('merges by id with newer wins and adds the rest', async () => {
    const stored = new Map([['d1', { id: 'd1', updatedAt: 50 }], ['d2', { id: 'd2', updatedAt: 5 }]]);
    const puts = [];
    const counts = await mergeDocuments([...docs, { title: 'New', content: contentFromMarkdown('n\n') }], {
      list: async () => [...stored.values()],
      put: async (d) => puts.push(d),
      now: () => 99,
    });
    expect(counts).toEqual({ added: 1, updated: 1, skipped: 1 });
    expect(puts.map((d) => d.id)).toEqual(['d2', expect.any(String)]);
    expect(puts[1]).toMatchObject({ title: 'New', createdAt: 99, updatedAt: 99 });
  });

  it('unions dictionary and disabled rules without touching other preferences', () => {
    expect(mergePrefs({ dialect: 'en-US', dictionary: ['b'], disabledRules: [] }, { dialect: 'en-GB', dictionary: ['a', 'b', 3], disabledRules: ['r'] }))
      .toEqual({ dialect: 'en-US', dictionary: ['a', 'b'], disabledRules: ['r'] });
    expect(mergePrefs({ dictionary: ['x'] }, null)).toEqual({ dictionary: ['x'] });
  });
});
