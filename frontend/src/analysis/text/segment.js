// Sentence and word segmentation with UTF-16 offsets.

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

// Abbreviations that end with a period but rarely end a sentence.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'e.g', 'i.e',
  'inc', 'ltd', 'co', 'corp', 'no', 'fig', 'approx', 'dept', 'est', 'jan', 'feb', 'mar',
  'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'u.s', 'a.m', 'p.m',
]);

/** @typedef {{ from: number, to: number, text: string }} Span */

/**
 * Sentences with trailing whitespace trimmed from each range.
 * @param {string} text
 * @returns {Span[]}
 */
export function sentences(text) {
  /** @type {Span[]} */
  const raw = [];
  for (const { index, segment } of sentenceSegmenter.segment(text)) {
    raw.push({ from: index, to: index + segment.length, text: segment });
  }
  /** @type {Span[]} */
  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev && endsWithAbbreviation(prev.text)) {
      prev.to = s.to;
      prev.text += s.text;
    } else {
      merged.push({ ...s });
    }
  }
  return merged
    .map((s) => {
      const trimmed = s.text.replace(/\s+$/u, '');
      const lead = s.text.length - s.text.replace(/^\s+/u, '').length;
      return { from: s.from + lead, to: s.from + trimmed.length, text: trimmed.slice(lead) };
    })
    .filter((s) => s.to > s.from);
}

function endsWithAbbreviation(sentence) {
  const m = /([A-Za-z][A-Za-z.]*)\.\s*$/u.exec(sentence);
  if (!m) return false;
  const word = m[1].toLowerCase();
  if (ABBREVIATIONS.has(word)) return true;
  // Single initials such as "J. Smith".
  return /^[a-z]$/u.test(word) && /(^|\s)[A-Z]\.\s*$/u.test(sentence);
}

/**
 * Word-like segments (letters or digits).
 * @param {string} text
 * @returns {Span[]}
 */
export function words(text) {
  /** @type {Span[]} */
  const out = [];
  for (const { index, segment, isWordLike } of wordSegmenter.segment(text)) {
    if (isWordLike) out.push({ from: index, to: index + segment.length, text: segment });
  }
  return out;
}

/** @param {string} text */
export function countWords(text) {
  let n = 0;
  for (const { isWordLike } of wordSegmenter.segment(text)) if (isWordLike) n++;
  return n;
}

const SKIP_PATTERNS = [
  /\bhttps?:\/\/[^\s<>"')\]]+/giu,
  /\bwww\.[^\s<>"')\]]+/giu,
  /[\w.+-]+@[\w-]+(\.[\w-]+)+/gu,
  /`[^`\n]+`/gu,
];

/**
 * Ranges that are not prose (URLs, email addresses, inline code) and should
 * not be checked for spelling or style.
 * @param {string} text
 * @returns {{ from: number, to: number }[]}
 */
export function nonProseSpans(text) {
  const spans = [];
  for (const re of SKIP_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      let end = m.index + m[0].length;
      // Trailing sentence punctuation is not part of a URL.
      while (end > m.index && /[.,;:!?]/u.test(text[end - 1])) end--;
      spans.push({ from: m.index, to: end });
    }
  }
  return spans.sort((a, b) => a.from - b.from);
}

/** @param {{from:number,to:number}[]} spans @param {number} from @param {number} to */
export function overlapsAny(spans, from, to) {
  return spans.some((s) => from < s.to && s.from < to);
}
