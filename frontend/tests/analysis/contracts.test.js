import { describe, it, expect } from 'vitest';
import { validator, fixtures } from '../helpers/contracts.js';
import { snapshotFromMarkdown } from '../../src/analysis/snapshot/from-markdown.js';

const NAMES = /** @type {const} */ (['snapshot', 'issue', 'envelope', 'ai-request', 'stream-event']);

describe('contract fixtures', () => {
  for (const name of NAMES) {
    const validate = validator(name);
    for (const { file, data } of fixtures(name, 'valid')) {
      it(`${name}/valid/${file}`, () => expect(validate(data).errors).toEqual([]));
    }
    for (const { file, data } of fixtures(name, 'invalid')) {
      it(`${name}/invalid/${file}`, () => expect(validate(data).ok).toBe(false));
    }
  }
});

describe('snapshot builders', () => {
  it('parses the Markdown subset into a valid snapshot with marks', () => {
    const snap = snapshotFromMarkdown(
      '# Title\n\nHello **bold** and *it* with [a link](https://x.y) and `code`.\nSecond line.\n\n- item one\n2. item two\n\n> quoted\n\n```\nlet x\n```',
      { documentId: 'd', revision: 3 },
    );
    expect(validator('snapshot')(snap).errors).toEqual([]);
    expect(snap.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'listItem', 'listItem', 'blockquote', 'codeBlock']);
    const p = snap.blocks[1];
    expect(p.text).toBe('Hello bold and it with a link and code. Second line.');
    const marked = Object.fromEntries(p.marks.map((m) => [m.type, p.text.slice(m.from, m.to)]));
    expect(marked).toEqual({ bold: 'bold', italic: 'it', link: 'a link', code: 'code' });
    expect(snap.blocks[0]).toMatchObject({ level: 1, text: 'Title' });
  });

  it('treats intraword underscores as text', () => {
    expect(snapshotFromMarkdown('use snake_case_name here').blocks[0].text).toBe('use snake_case_name here');
  });

  it('changes the fingerprint when text or marks change', () => {
    const a = snapshotFromMarkdown('Hello world').blocks[0].fingerprint;
    const b = snapshotFromMarkdown('Hello **world**').blocks[0].fingerprint;
    const c = snapshotFromMarkdown('Hello world!').blocks[0].fingerprint;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
