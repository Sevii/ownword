// Heuristic English syllable estimator. Bump the version when the algorithm
// changes so readability results stay comparable across eval reports.

export const SYLLABLE_ESTIMATOR_VERSION = 'heuristic-1';

const EXCEPTIONS = new Map([
  ['the', 1], ['every', 2], ['different', 3], ['business', 2], ['people', 2],
  ['area', 3], ['idea', 3], ['create', 2], ['created', 3], ['being', 2],
  ['science', 2], ['quiet', 2], ['poem', 2], ['naive', 2], ['real', 1],
  ['really', 2], ['fire', 1], ['hour', 1], ['our', 1], ['email', 2],
]);

/** @param {string} word */
export function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/gu, '');
  if (!w) return 0;
  const known = EXCEPTIONS.get(w);
  if (known) return known;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/u, '');
  w = w.replace(/^y/u, '');
  const groups = w.match(/[aeiouy]{1,2}/gu);
  return Math.max(1, groups ? groups.length : 1);
}
