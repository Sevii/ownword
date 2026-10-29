// A daily word goal (improvement plan §4.5): words added today across every
// document. Each document's last seen count is a baseline; only growth
// counts, so deleting and retyping does not inflate the number.

export const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * @param {{ date: string, words: number }} progress today's total so far
 * @param {Map<string, number>} baselines document id -> last seen word count (mutated)
 * @param {string} docId @param {number} words the document's current count
 * @param {string} [date]
 * @returns {{ date: string, words: number }} the new progress (same object when unchanged)
 */
export function advanceGoal(progress, baselines, docId, words, date = todayKey()) {
  const base = baselines.get(docId);
  baselines.set(docId, words);
  const fresh = progress.date === date ? progress : { date, words: 0 };
  if (base === undefined) return fresh; // first look at this document: a baseline, not writing
  const delta = words - base;
  if (delta <= 0) return fresh;
  return { date, words: fresh.words + delta };
}
