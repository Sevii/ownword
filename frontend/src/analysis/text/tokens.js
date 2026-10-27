// Token stream for rules and protected-span extraction.

const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

/** @typedef {{ kind: 'word'|'number'|'punct'|'space', from: number, to: number, text: string }} Token */

/**
 * @param {string} text
 * @returns {Token[]}
 */
export function tokenize(text) {
  /** @type {Token[]} */
  const out = [];
  for (const { index, segment, isWordLike } of wordSegmenter.segment(text)) {
    const span = { from: index, to: index + segment.length, text: segment };
    if (isWordLike) out.push({ kind: /^\d/u.test(segment) ? 'number' : 'word', ...span });
    else if (/^\s+$/u.test(segment)) out.push({ kind: 'space', ...span });
    else out.push({ kind: 'punct', ...span });
  }
  return out;
}

/** Word and number tokens only. @param {string} text */
export function wordTokens(text) {
  return tokenize(text).filter((t) => t.kind === 'word' || t.kind === 'number');
}
