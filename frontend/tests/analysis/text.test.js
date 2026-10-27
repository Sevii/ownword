import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  scalarToUtf16, utf16ToScalar, utf16ToUtf8, utf8ToUtf16, isValidRange, isGraphemeBoundary,
} from '../../src/analysis/text/offsets.js';
import { sentences, words, countWords, nonProseSpans } from '../../src/analysis/text/segment.js';
import { tokenize } from '../../src/analysis/text/tokens.js';
import { syllables } from '../../src/analysis/text/syllables.js';

// Strings that stress every coordinate system.
const tricky = fc.array(
  fc.constantFrom('a', 'é', 'é', '😀', '👨‍👩‍👧', '𝒜', ' ', 'teh', '中', '‍', '.'),
  { maxLength: 30 },
).map((parts) => parts.join(''));

describe('offsets', () => {
  it('converts the contract example', () => {
    const t = 'A😀 teh';
    expect(t.slice(4, 7)).toBe('teh');
    expect(utf16ToScalar(t, 4)).toBe(3);
    expect(scalarToUtf16(t, 3)).toBe(4);
    expect(utf16ToUtf8(t, 4)).toBe(6);
    expect(utf8ToUtf16(t, 6)).toBe(4);
  });

  it('rejects offsets inside a surrogate pair or a UTF-8 sequence', () => {
    const t = 'A😀b';
    expect(utf16ToScalar(t, 2)).toBe(-1);
    expect(utf8ToUtf16(t, 2)).toBe(-1);
    expect(isValidRange(t, 1, 2)).toBe(false);
  });

  it('rejects ranges that split a grapheme cluster', () => {
    const t = 'café x';
    expect(isGraphemeBoundary(t, 4)).toBe(false);
    expect(isValidRange(t, 0, 4)).toBe(false);
    expect(isValidRange(t, 0, 5)).toBe(true);
  });

  it('round-trips scalar and UTF-8 offsets at every code point boundary', () => {
    fc.assert(
      fc.property(tricky, (text) => {
        let scalar = 0;
        for (let u16 = 0; u16 <= text.length; ) {
          expect(utf16ToScalar(text, u16)).toBe(scalar);
          expect(scalarToUtf16(text, scalar)).toBe(u16);
          expect(utf8ToUtf16(text, utf16ToUtf8(text, u16))).toBe(u16);
          if (u16 === text.length) break;
          u16 += text.codePointAt(u16) > 0xffff ? 2 : 1;
          scalar++;
        }
      }),
    );
  });

  it('only reports valid ranges on grapheme boundaries', () => {
    fc.assert(
      fc.property(tricky, fc.nat(), fc.nat(), (text, a, b) => {
        const from = a % (text.length + 1);
        const to = b % (text.length + 1);
        if (!isValidRange(text, from, to)) return;
        const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].map((s) => s.index);
        expect(from === text.length || graphemes.includes(from)).toBe(true);
        expect(to === text.length || graphemes.includes(to)).toBe(true);
      }),
    );
  });
});

describe('segmentation', () => {
  it('keeps abbreviations inside sentences', () => {
    const s = sentences('Dr. Smith met Mr. J. Jones at 5 p.m. today. Then he left.');
    expect(s.map((x) => x.text)).toEqual(['Dr. Smith met Mr. J. Jones at 5 p.m. today.', 'Then he left.']);
  });

  it('returns trimmed ranges that slice back to the sentence', () => {
    const text = '  First one.   Second 😀 one!  ';
    for (const s of sentences(text)) expect(text.slice(s.from, s.to)).toBe(s.text);
  });

  it('counts words and finds non-prose spans', () => {
    expect(countWords("It's a test, isn't it?")).toBe(5);
    expect(words('A😀 teh')[1]).toEqual({ from: 4, to: 7, text: 'teh' });
    const t = 'See https://example.com/a. Mail me@x.org or run `npm i`.';
    expect(nonProseSpans(t).map((s) => t.slice(s.from, s.to))).toEqual(['https://example.com/a', 'me@x.org', '`npm i`']);
  });

  it('tokenizes with kinds', () => {
    expect(tokenize('Pay $5 now.').map((t) => t.kind)).toEqual(['word', 'space', 'punct', 'number', 'space', 'word', 'punct']);
  });

  it('estimates syllables', () => {
    expect([syllables('cat'), syllables('table'), syllables('readability'), syllables('the')]).toEqual([1, 2, 5, 1]);
  });
});
