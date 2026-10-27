// Gentle observation on long sentences. Threshold is a setting.

import { sentences, countWords } from '../text/segment.js';

export const DEFAULT_LONG_SENTENCE_WORDS = 30;

export default {
  id: 'style.long-sentence',
  version: 1,
  category: 'sentence-length',
  classification: 'style',
  scope: 'block',
  canReplace: false,
  /** @param {import('../types.js').Block} block @param {{ settings: import('../types.js').Settings }} ctx */
  run(block, ctx) {
    const limit = ctx.settings.longSentenceWords ?? DEFAULT_LONG_SENTENCE_WORDS;
    const out = [];
    for (const s of sentences(block.text)) {
      const n = countWords(s.text);
      if (n <= limit) continue;
      out.push({
        blockId: block.id,
        from: s.from,
        to: s.to,
        ruleId: this.id,
        category: this.category,
        classification: this.classification,
        message: `This sentence has ${n} words. Splitting it may make it easier to follow.`,
        replacements: [],
      });
    }
    return out;
  },
};
