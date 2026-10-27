// Suppression: personal dictionary, disabled rules, dismissed occurrences
// (docs/proofreading-design.md §6).

/**
 * @typedef {import('../types.js').Issue} Issue
 * @typedef {import('../types.js').Snapshot} Snapshot
 * @typedef {{ ruleId: string, blockId: string, fingerprint: string, from: number, expectedText: string }} OccurrenceDismissal
 * @typedef {{ dictionary?: Iterable<string>, disabledRules?: Iterable<string>,
 *   occurrences?: OccurrenceDismissal[] }} Suppressions
 */

/**
 * Dictionary matching: an entry with any capital letter matches exactly; an
 * all-lowercase entry also matches the capitalized form at a sentence start.
 * @param {Iterable<string>} entries
 */
export function dictionaryMatcher(entries) {
  const exact = new Set(entries);
  return (/** @type {string} */ word) => {
    if (exact.has(word)) return true;
    const lower = word.toLowerCase();
    return word === lower[0]?.toUpperCase() + lower.slice(1) && exact.has(lower);
  };
}

/**
 * @param {Snapshot} snapshot
 * @param {Issue[]} issues
 * @param {Suppressions} s
 * @returns {Issue[]}
 */
export function applySuppressions(snapshot, issues, s) {
  const inDictionary = dictionaryMatcher(s.dictionary ?? []);
  const disabled = new Set(s.disabledRules ?? []);
  const fingerprints = new Map(snapshot.blocks.map((b) => [b.id, b.fingerprint]));
  const occurrences = s.occurrences ?? [];
  return issues.filter((issue) => {
    if (disabled.has(issue.origin.ruleId)) return false;
    const a = issue.anchor;
    if (!a) return true;
    if (issue.category === 'spelling' && inDictionary(a.expectedText)) return false;
    return !occurrences.some(
      (o) =>
        o.ruleId === issue.origin.ruleId &&
        o.blockId === a.blockId &&
        o.fingerprint === fingerprints.get(a.blockId) &&
        o.from === a.from &&
        o.expectedText === a.expectedText,
    );
  });
}

/**
 * The record to persist when a user dismisses one occurrence. It stops
 * matching as soon as the block changes.
 * @param {Snapshot} snapshot @param {Issue} issue
 * @returns {OccurrenceDismissal | null}
 */
export function dismissalFor(snapshot, issue) {
  const a = issue.anchor;
  const block = a && snapshot.blocks.find((b) => b.id === a.blockId);
  if (!a || !block) return null;
  return { ruleId: issue.origin.ruleId, blockId: a.blockId, fingerprint: block.fingerprint, from: a.from, expectedText: a.expectedText };
}
