// Conspicuous nearby repetition of a content word. Observation only; no
// forced synonym.

import { wordTokens } from '../text/tokens.js';
import { STOPWORDS } from './stopwords.js';

const WINDOW_WORDS = 12;
const MIN_LENGTH = 4;

/** Crude stem so "plan", "plans", "planned" count as the same word. */
function stem(word) {
  return word
    .toLowerCase()
    .replace(/'s$/u, '')
    .replace(/(ing|ed|es|s)$/u, '')
    .replace(/(.)\1$/u, '$1');
}

export default {
  id: 'style.nearby-repetition',
  version: 1,
  category: 'repetition',
  classification: 'style',
  scope: 'block',
  canReplace: false,
  /** @param {import('../types.js').Block} block */
  run(block) {
    const out = [];
    const tokens = wordTokens(block.text).filter((t) => t.kind === 'word');
    /** @type {Map<string, number>} stem -> last token index */
    const seen = new Map();
    const flagged = new Set();
    tokens.forEach((t, i) => {
      const lower = t.text.toLowerCase();
      if (lower.length < MIN_LENGTH || STOPWORDS.has(lower)) return;
      // Capitalized words mid-text are usually names; repeating them is fine.
      if (/^[A-Z]/u.test(t.text) && i > 0) return;
      const key = stem(t.text);
      const prev = seen.get(key);
      seen.set(key, i);
      if (prev === undefined || i - prev > WINDOW_WORDS || flagged.has(key)) return;
      flagged.add(key);
      out.push({
        blockId: block.id,
        from: t.from,
        to: t.to,
        ruleId: this.id,
        category: this.category,
        classification: this.classification,
        message: `“${t.text}” repeats a word used just before. Consider rephrasing if it reads awkwardly.`,
        replacements: [],
      });
    });
    return out;
  },
};
