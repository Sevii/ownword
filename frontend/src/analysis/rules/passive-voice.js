// Passive voice observation: a form of "be" followed by a past participle.
// Observation only; passive voice is often the right choice.

const BE = '(?:am|is|are|was|were|be|been|being)';
const IRREGULAR = [
  'awoken', 'beaten', 'become', 'begun', 'bent', 'bitten', 'blown', 'broken', 'brought',
  'built', 'bought', 'caught', 'chosen', 'done', 'drawn', 'driven', 'eaten', 'fallen', 'felt',
  'forgotten', 'forgiven', 'found', 'frozen', 'given', 'gone', 'grown', 'heard', 'held', 'hidden',
  'hit', 'hurt', 'kept', 'known', 'laid', 'led', 'left', 'lent', 'lost', 'made', 'meant', 'met',
  'paid', 'put', 'read', 'ridden', 'rung', 'risen', 'run', 'said', 'seen', 'sent', 'set', 'shaken',
  'shown', 'shut', 'sold', 'sought', 'spent', 'spoken', 'stolen', 'struck', 'sung', 'sunk',
  'swept', 'taken', 'taught', 'thrown', 'told', 'thought', 'understood', 'won', 'worn', 'woven',
  'written',
].join('|');
// Common adjectives ending in -ed that read as states, not actions.
const ADJECTIVES = new Set([
  'interested', 'tired', 'excited', 'worried', 'pleased', 'concerned', 'involved', 'married',
  'supposed', 'used', 'based', 'located', 'related', 'experienced', 'qualified', 'prepared',
  'scheduled', 'committed', 'satisfied', 'surprised', 'bored', 'confused', 'disappointed',
  'embarrassed', 'frustrated', 'scared', 'shocked', 'amazed', 'annoyed', 'relieved', 'convinced',
  'determined', 'dedicated', 'designed', 'aged', 'advanced', 'detailed', 'limited', 'needed',
]);
const PATTERN = new RegExp(`\\b${BE}\\s+(?:\\w+ly\\s+)?(\\w+ed|${IRREGULAR})\\b`, 'giu');

export default {
  id: 'style.passive-voice',
  version: 1,
  category: 'passive-voice',
  classification: 'style',
  scope: 'block',
  canReplace: false,
  /** @param {import('../types.js').Block} block */
  run(block) {
    const out = [];
    PATTERN.lastIndex = 0;
    for (const m of block.text.matchAll(PATTERN)) {
      if (ADJECTIVES.has(m[1].toLowerCase())) continue;
      out.push({
        blockId: block.id,
        from: m.index,
        to: m.index + m[0].length,
        ruleId: this.id,
        category: this.category,
        classification: this.classification,
        message: 'Passive voice. If who acts matters, an active sentence may be clearer.',
        replacements: [],
      });
    }
    return out;
  },
};
