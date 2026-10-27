// Document profile: deterministic statistics the UI shows now and the AI
// stages consume later.

import { sentences, countWords, words } from './text/segment.js';
import { syllables, SYLLABLE_ESTIMATOR_VERSION } from './text/syllables.js';
import { extractProtected } from './meaning/protected.js';

const READING_WPM = 238;
const STABLE_READABILITY_WORDS = 100;

/**
 * @param {import('./types.js').Snapshot} snapshot
 * @param {import('./types.js').Settings} [settings]
 * @param {{ protectedSpans?: boolean }} [opts] the UI skips protected spans, which only AI stages use
 */
export function documentProfile(snapshot, settings = {}, opts = {}) {
  const prose = snapshot.blocks.filter((b) => b.type !== 'codeBlock' && b.text.trim());
  let wordCount = 0;
  let syllableCount = 0;
  let characters = 0;
  let charactersNoSpaces = 0;
  const sentenceList = [];
  for (const block of snapshot.blocks) {
    characters += block.text.length;
    charactersNoSpaces += block.text.replace(/\s/gu, '').length;
  }
  for (const block of prose) {
    for (const w of words(block.text)) {
      wordCount++;
      syllableCount += syllables(w.text);
    }
    sentences(block.text).forEach((s, i) => {
      sentenceList.push({ id: `${block.id}:s${i}`, blockId: block.id, from: s.from, to: s.to, words: countWords(s.text) });
    });
  }
  const sentenceCount = sentenceList.filter((s) => s.words > 0).length;
  const flesch =
    wordCount && sentenceCount
      ? 206.835 - 1.015 * (wordCount / sentenceCount) - 84.6 * (syllableCount / wordCount)
      : null;
  const lengths = sentenceList.map((s) => s.words).filter((n) => n > 0);
  return {
    counts: {
      words: wordCount,
      characters,
      charactersNoSpaces,
      sentences: sentenceCount,
      paragraphs: prose.length,
      readingMinutes: wordCount / READING_WPM,
    },
    readability: {
      measure: 'Flesch Reading Ease',
      score: flesch === null ? null : Math.round(flesch * 10) / 10,
      stable: wordCount >= STABLE_READABILITY_WORDS,
      estimator: SYLLABLE_ESTIMATOR_VERSION,
    },
    sentenceLengths: {
      mean: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0,
      max: lengths.length ? Math.max(...lengths) : 0,
      longest: [...sentenceList].sort((a, b) => b.words - a.words).slice(0, 3),
    },
    goals: settings.goals ?? {},
    ...(opts.protectedSpans === false ? {} : { protectedSpans: Object.fromEntries(prose.map((b) => [b.id, extractProtected(b.text)])) }),
  };
}
