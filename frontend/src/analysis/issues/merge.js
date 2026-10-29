// Deduplicate, order, and find conflicts among issues from several engines.

/** @typedef {import('../types.js').Issue} Issue */
/** @typedef {import('../types.js').Snapshot} Snapshot */

const CLASS_ORDER = { 'likely-error': 0, style: 1, 'review-question': 2 };

/**
 * Merge findings from several sources. Findings on the same range collapse
 * into one when they offer a common replacement, or when neither offers any
 * and they agree on the category (the first source wins; others are listed
 * in provenance).
 * @param {Snapshot} snapshot
 * @param {Issue[]} issues
 * @returns {{ findings: Issue[], provenance: Map<string, string[]> }}
 */
export function mergeIssues(snapshot, issues) {
  const order = new Map(snapshot.blocks.map((b, i) => [b.id, i]));
  const texts = new Map(snapshot.blocks.map((b) => [b.id, b.text]));
  /** @type {Map<string, Issue>} */
  const byKey = new Map();
  /** @type {Map<string, string[]>} */
  const provenance = new Map();
  /** @type {Map<string, Issue[]>} same range -> merged findings there */
  const byRange = new Map();
  for (const issue of issues) {
    const range = rangeKey(issue);
    const existing =
      (range && byRange.get(range)?.find((e) => sameSuggestion(e, issue))) ||
      (issue.anchor && [...byKey.values()].find((e) => sameEdit(e, issue, texts.get(issue.anchor.blockId))));
    if (existing) {
      provenance.get(existing.id)?.push(issue.id);
      // Prefer the stronger classification when sources disagree.
      if (CLASS_ORDER[issue.classification] < CLASS_ORDER[existing.classification]) {
        existing.classification = issue.classification;
      }
      continue;
    }
    const copy = { ...issue };
    byKey.set(copy.id, copy);
    if (range) byRange.set(range, [...(byRange.get(range) ?? []), copy]);
    provenance.set(copy.id, [copy.id]);
  }
  const findings = [...byKey.values()].sort((a, b) => compare(a, b, order));
  return { findings, provenance };
}

/** @param {Issue} issue */
function rangeKey(issue) {
  const a = issue.anchor;
  return a ? `${a.blockId}:${a.from}:${a.to}` : null;
}

/**
 * Two overlapping findings in one block are the same correction when some
 * replacement of each produces the same block text ("Its"→"It's" and
 * "Its the"→"It's the").
 */
function sameEdit(a, b, text) {
  const x = a.anchor;
  const y = b.anchor;
  if (!x || !y || text === undefined || x.blockId !== y.blockId) return false;
  if (!(x.from < y.to && y.from < x.to) || !a.replacements.length || !b.replacements.length) return false;
  const apply = (r, t) => text.slice(0, r.from) + t + text.slice(r.to);
  const results = new Set(a.replacements.map((r) => apply(x, r.text)));
  return b.replacements.some((r) => results.has(apply(y, r.text)));
}

/** Two findings on one range say the same thing when a replacement is shared. */
function sameSuggestion(a, b) {
  const ra = new Set(a.replacements.map((r) => r.text.trim()));
  const rb = b.replacements.map((r) => r.text.trim());
  if (!ra.size && !rb.length) return a.category === b.category;
  return rb.some((t) => ra.has(t));
}

/** @param {Issue} a @param {Issue} b @param {Map<string, number>} order */
function compare(a, b, order) {
  const c = CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification];
  if (c) return c;
  const pa = position(a, order);
  const pb = position(b, order);
  return pa[0] - pb[0] || pa[1] - pb[1] || a.id.localeCompare(b.id);
}

/** @param {Issue} issue @param {Map<string, number>} order */
function position(issue, order) {
  const blockId = issue.anchor?.blockId ?? issue.evidence?.[0]?.blockId;
  return [order.get(blockId) ?? Number.MAX_SAFE_INTEGER, issue.anchor?.from ?? 0];
}

/**
 * Overlapping anchored findings: accepting one invalidates the others.
 * @param {Issue[]} findings
 * @returns {Map<string, string[]>} issue ID -> IDs it conflicts with
 */
export function findConflicts(findings) {
  /** @type {Map<string, string[]>} */
  const conflicts = new Map();
  const anchored = findings.filter((f) => f.anchor && f.replacements.length);
  for (let i = 0; i < anchored.length; i++) {
    for (let j = i + 1; j < anchored.length; j++) {
      const a = anchored[i].anchor;
      const b = anchored[j].anchor;
      if (a.blockId !== b.blockId) continue;
      const overlap = a.from < b.to && b.from < a.to;
      const sameInsertPoint = a.from === a.to && b.from === b.to && a.from === b.from;
      if (!overlap && !sameInsertPoint) continue;
      for (const [x, y] of [[anchored[i], anchored[j]], [anchored[j], anchored[i]]]) {
        const list = conflicts.get(x.id) ?? [];
        list.push(y.id);
        conflicts.set(x.id, list);
      }
    }
  }
  return conflicts;
}
