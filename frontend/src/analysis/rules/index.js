// Application rule registry. Bump RULES_VERSION when any rule's behavior
// changes so eval reports and dismissals stay attributable.

import redundantPhrase from './redundant-phrase.js';
import repetition from './repetition.js';
import longSentence from './long-sentence.js';
import passiveVoice from './passive-voice.js';
import hedging from './hedging.js';
import { nonProseSpans, overlapsAny } from '../text/segment.js';

export const RULES_VERSION = '1';

export const ALL_RULES = [redundantPhrase, repetition, longSentence, passiveVoice, hedging];

/**
 * Run rules over a snapshot as an engine, matching the Harper engine's shape.
 * @param {typeof ALL_RULES} [rules]
 */
export function createRulesEngine(rules = ALL_RULES) {
  return {
    name: 'rules',
    version: RULES_VERSION,
    setup: async () => {},
    /**
     * @param {import('../types.js').Snapshot} snapshot
     * @param {import('../types.js').Settings} settings
     * @param {Set<string>} [blockIds]
     */
    async run(snapshot, settings, blockIds) {
      /** @type {import('../types.js').RawFinding[]} */
      const findings = [];
      for (const block of snapshot.blocks) {
        if (block.type === 'codeBlock' || !block.text.trim()) continue;
        if (blockIds && !blockIds.has(block.id)) continue;
        const skip = [...nonProseSpans(block.text), ...block.marks.filter((m) => m.type === 'code')];
        for (const rule of rules) {
          for (const f of rule.run(block, { settings })) {
            if (!overlapsAny(skip, f.from, f.to)) findings.push(f);
          }
        }
      }
      return { findings, rejected: 0 };
    },
  };
}
