// Protected spans: wording whose change usually changes meaning (numbers,
// money, dates, negation, modality, conditions, names, quotes, URLs).
// Used by the eval harness (forbidden changes), the A07 rewrite guard, and
// local replacement sanity checks. A heuristic guard, not a proof.

import { sentences } from '../text/segment.js';
import { wordTokens } from '../text/tokens.js';

export const PROTECTED_VERSION = '1';

/** @typedef {'money'|'percent'|'number'|'date'|'time'|'negation'|'modality'|'condition'|'name'|'quote'|'url'} ProtectedKind */
/** @typedef {{ kind: ProtectedKind, from: number, to: number, text: string, normalized: string }} ProtectedSpan */

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6, billion: 1e9, dozen: 12,
  half: 0.5, once: 1, twice: 2,
};
const WEEKDAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';

// Ordered by priority: an earlier kind claims its range first.
/** @type {[ProtectedKind, RegExp][]} */
const PATTERNS = [
  ['url', /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/giu],
  ['quote', /"[^"\n]{1,500}"|“[^”\n]{1,500}”/gu],
  ['money', /[$€£¥]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|bn|million|billion|thousand)\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|dollars?|euros?|pounds?|cents?)\b/giu],
  ['percent', /\b\d+(?:\.\d+)?\s?(?:%|percent\b)/giu],
  ['time', /\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?=\W|$)|\b\d{1,2}:\d{2}\b|\b(?:noon|midnight|EOD|COB)\b/giu],
  ['date', new RegExp(
    `\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?\\b` +
    `|\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b` +
    `|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b(?:,?\\s+\\d{4})?` +
    `|\\b(?:${WEEKDAYS})\\b|\\b(?:today|tomorrow|yesterday|tonight|asap)\\b` +
    `|\\b(?:next|this|last)\\s+(?:week|month|year|quarter|${WEEKDAYS})\\b` +
    `|\\bend\\s+of\\s+(?:the\\s+)?(?:day|week|month|quarter|year)\\b` +
    `|\\b(?:january|february|march|april|june|july|august|september|october|november|december)\\b`,
    'giu')],
  ['number', new RegExp(`\\b\\d[\\d,]*(?:\\.\\d+)?\\b|\\b(?:${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'giu')],
  ['negation', /\b(?:not|no|never|none|nothing|nobody|neither|nor|without|cannot)\b|\b\w+n['’]t\b/giu],
  ['modality', /\b(?:may|might|must|will|would|shall|should|can|could|probably|possibly|likely|unlikely|perhaps|maybe|definitely|certainly|guaranteed?)\b/giu],
  ['condition', /\b(?:if|unless|except|only|provided|until|whether|subject\s+to)\b/giu],
];

const NAME_EXCLUDE = new Set(['I', 'OK']);

/**
 * @param {string} text
 * @returns {ProtectedSpan[]}
 */
export function extractProtected(text) {
  /** @type {ProtectedSpan[]} */
  const spans = [];
  const taken = (from, to) => spans.some((s) => from < s.to && s.from < to);
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      let from = m.index;
      let to = from + m[0].length;
      if (kind === 'url') while (to > from && /[.,;:!?]/u.test(text[to - 1])) to--;
      // "May" as a month is claimed by 'date' only when followed by a day.
      if (taken(from, to)) continue;
      spans.push({ kind, from, to, text: text.slice(from, to), normalized: normalize(kind, text.slice(from, to)) });
    }
  }
  for (const s of nameSpans(text)) if (!taken(s.from, s.to)) spans.push(s);
  return spans.sort((a, b) => a.from - b.from);
}

/** Capitalized words that do not start a sentence, plus acronyms and mixed case. */
function nameSpans(text) {
  const starts = new Set(sentences(text).map((s) => s.from));
  /** @type {ProtectedSpan[]} */
  const out = [];
  for (const t of wordTokens(text)) {
    if (t.kind !== 'word' || NAME_EXCLUDE.has(t.text)) continue;
    const acronym = /^[A-Z]{2,}\d*$/u.test(t.text);
    const mixed = /^[a-z]+[A-Z]/u.test(t.text);
    const capitalized = /^[A-Z][a-z]/u.test(t.text) && !starts.has(t.from) && !afterOpeningQuote(text, t.from);
    if (acronym || mixed || capitalized) {
      out.push({ kind: 'name', from: t.from, to: t.to, text: t.text, normalized: t.text });
    }
  }
  return out;
}

function afterOpeningQuote(text, at) {
  return /["“(]\s*$/u.test(text.slice(Math.max(0, at - 2), at));
}

/** @param {ProtectedKind} kind @param {string} s */
function normalize(kind, s) {
  const lower = s.toLowerCase().replace(/\s+/gu, ' ');
  switch (kind) {
    case 'number':
      return String(NUMBER_WORDS[lower] ?? Number(lower.replace(/,/gu, '')));
    case 'money':
    case 'percent':
      return lower.replace(/[\s,]/gu, '').replace('percent', '%');
    case 'negation':
      return /n['’]t$|^cannot$/u.test(lower) ? 'not' : lower;
    case 'quote':
      return s.replace(/^["“]|["”]$/gu, '');
    case 'time':
      return lower.replace(/\./gu, '').replace(/\s/gu, '');
    default:
      return lower;
  }
}

/**
 * Compare protected spans between source and result texts (whole blocks or a
 * whole document joined). Reports values whose count changed, per kind.
 * @param {string} source @param {string} result
 * @returns {{ removed: ProtectedSpan[], added: ProtectedSpan[] }}
 */
export function compareProtected(source, result) {
  const a = extractProtected(source);
  const b = extractProtected(result);
  const key = (/** @type {ProtectedSpan} */ s) => `${s.kind}\u0000${s.normalized}`;
  const countB = new Map();
  for (const s of b) countB.set(key(s), (countB.get(key(s)) ?? 0) + 1);
  const countA = new Map();
  for (const s of a) countA.set(key(s), (countA.get(key(s)) ?? 0) + 1);
  const removed = [];
  const seenA = new Map();
  for (const s of a) {
    const k = key(s);
    const n = (seenA.get(k) ?? 0) + 1;
    seenA.set(k, n);
    if (n > (countB.get(k) ?? 0)) removed.push(s);
  }
  const added = [];
  const seenB = new Map();
  for (const s of b) {
    const k = key(s);
    const n = (seenB.get(k) ?? 0) + 1;
    seenB.set(k, n);
    if (n > (countA.get(k) ?? 0)) added.push(s);
  }
  return { removed, added };
}
