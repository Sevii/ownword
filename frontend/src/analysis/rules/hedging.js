// Hedges and fillers that often weaken a sentence. Observation only: removing
// them can change tone or meaning, so no replacement is offered.

const TERMS = [
  'I think', 'I believe', 'I feel like', 'kind of', 'sort of', 'basically', 'actually',
  'literally', 'just', 'really', 'very', 'quite', 'somewhat', 'perhaps', 'arguably',
];
const PATTERN = new RegExp(`\\b(?:${TERMS.map((t) => t.replace(/ /gu, '\\s+')).join('|')})\\b`, 'giu');

export default {
  id: 'style.hedging',
  version: 1,
  category: 'hedging',
  classification: 'style',
  scope: 'block',
  canReplace: false,
  /** @param {import('../types.js').Block} block */
  run(block) {
    const out = [];
    PATTERN.lastIndex = 0;
    for (const m of block.text.matchAll(PATTERN)) {
      out.push({
        blockId: block.id,
        from: m.index,
        to: m.index + m[0].length,
        ruleId: this.id,
        category: this.category,
        classification: this.classification,
        message: `“${m[0]}” may weaken this sentence. Keep it if the softer tone is intended.`,
        replacements: [],
      });
    }
    return out;
  },
};
