// Curated wordy phrases with meaning-preserving shorter forms.

/** @type {[string, string][]} */
const PHRASES = [
  ['in order to', 'to'],
  ['due to the fact that', 'because'],
  ['in spite of the fact that', 'although'],
  ['despite the fact that', 'although'],
  ['at this point in time', 'now'],
  ['at the present time', 'now'],
  ['until such time as', 'until'],
  ['in the event that', 'if'],
  ['each and every', 'each'],
  ['a large number of', 'many'],
  ['the majority of', 'most'],
  ['in close proximity to', 'near'],
  ['with regard to', 'about'],
  ['with reference to', 'about'],
  ['absolutely essential', 'essential'],
  ['basic fundamentals', 'fundamentals'],
  ['past history', 'history'],
  ['end result', 'result'],
  ['free gift', 'gift'],
  ['advance planning', 'planning'],
  ['future plans', 'plans'],
  ['completely eliminate', 'eliminate'],
  ['join together', 'join'],
  ['new innovation', 'innovation'],
  ['repeat again', 'repeat'],
  ['revert back', 'revert'],
  ['first and foremost', 'first'],
  ['has the ability to', 'can'],
  ['is able to', 'can'],
  ['make a decision', 'decide'],
  ['give consideration to', 'consider'],
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const PATTERN = new RegExp(`\\b(?:${PHRASES.map(([p]) => escape(p).replace(/ /gu, '\\s+')).join('|')})\\b`, 'giu');
const LOOKUP = new Map(PHRASES.map(([p, r]) => [p, r]));

export default {
  id: 'style.redundant-phrase',
  version: 1,
  category: 'conciseness',
  classification: 'style',
  scope: 'block',
  canReplace: true,
  /** @param {import('../types.js').Block} block */
  run(block) {
    const out = [];
    PATTERN.lastIndex = 0;
    for (const m of block.text.matchAll(PATTERN)) {
      const key = m[0].toLowerCase().replace(/\s+/gu, ' ');
      let repl = LOOKUP.get(key);
      if (!repl) continue;
      if (/^[A-Z]/u.test(m[0])) repl = repl[0].toUpperCase() + repl.slice(1);
      out.push({
        blockId: block.id,
        from: m.index,
        to: m.index + m[0].length,
        ruleId: this.id,
        category: this.category,
        classification: this.classification,
        message: `“${m[0]}” can usually be shortened to “${repl}”.`,
        replacements: [repl],
      });
    }
    return out;
  },
};
