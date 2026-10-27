import { describe, it, expect } from 'vitest';
import { snapshotFromMarkdown } from '../../src/analysis/snapshot/from-markdown.js';
import { toMarkdown, toPlainText, toDocx, docxToHtml, safeFilename } from '../../src/documents/export.js';

const md = '# Plan\n\nShip **bold** and *it* with [a link](https://x.y) and `code`.\n\n- one\n- two\n\n> quote\n\n```\nlet x = 1\n```\n';

describe('export', () => {
  it('round-trips the supported Markdown subset', () => {
    const snap = snapshotFromMarkdown(md);
    expect(toMarkdown(snap)).toBe(md);
    expect(snapshotFromMarkdown(toMarkdown(snap)).blocks.map((b) => [b.type, b.text, b.marks])).toEqual(
      snap.blocks.map((b) => [b.type, b.text, b.marks]),
    );
  });

  it('escapes Markdown syntax in text', () => {
    const snap = snapshotFromMarkdown('a \\*star\\* and \\_under\\_');
    expect(snap.blocks[0].text).toBe('a *star* and _under_');
    expect(snapshotFromMarkdown(toMarkdown(snap)).blocks[0].text).toBe('a *star* and _under_');
  });

  it('does not escape text inside code spans', () => {
    const snap = snapshotFromMarkdown('Run `a_b*c` now');
    expect(toMarkdown(snap)).toBe('Run `a_b*c` now\n');
  });

  it('writes plain text without formatting', () => {
    expect(toPlainText(snapshotFromMarkdown(md))).toBe('Plan\n\nShip bold and it with a link and code.\n\n- one\n- two\n\nquote\n\nlet x = 1\n');
  });

  it('writes a .docx that converts back with text, formatting, and links intact', async () => {
    const blob = await toDocx(snapshotFromMarkdown(md));
    const { html } = await docxToHtml(await blob.arrayBuffer());
    expect(html).toContain('<h1>Plan</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<a href="https://x.y">a link</a>');
    expect(html).toMatch(/<li>one<\/li>\s*<li>two<\/li>/u);
  });

  it('makes safe filenames', () => {
    expect(safeFilename('a/b:c*?')).toBe('a b c');
    expect(safeFilename('')).toBe('Untitled');
  });
});
