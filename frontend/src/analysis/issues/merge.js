// Deduplicate, order, and find conflicts among issues from several engines.

/** @typedef {import('../types.js').Issue} Issue */
/** @typedef {import('../types.js').Snapshot} Snapshot */

const CLASS_ORDER = { 'likely-error': 0, style: 1, 'review-question': 2 };

/**
 * Merge findings from several sources. Identical range + replacement findings
 * collapse into one (the first source wins; others are listed in provenance).
 * @param {Snapshot} snapshot
 * @param {Issue[]} issues
 * @returns {{ findings: Issue[], provenance: Map<string, string[]> }}
 */
export function mergeIssues(snapshot, issues) {
  const order = new Map(snapshot.blocks.map((b, i) => [b.id, i]));
  /** @type {Map<string, Issue>} */
  const byKey = new Map();
  /** @type {Map<string, string[]>} */
  const provenance = new Map();
  for (const issue of issues) {
    const key = dedupeKey(issue);
    const existing = byKey.get(key);
    if (existing) {
      provenance.get(existing.id)?.push(issue.id);
      // Prefer the stronger classification when sources disagree.
      if (CLASS_ORDER[issue.classification] < CLASS_ORDER[existing.classification]) {
        existing.classification = issue.classification;
      }
      continue;
    }
    const copy = { ...issue };
    byKey.set(key, copy);
    provenance.set(copy.id, [copy.id]);
  }
  const findings = [...byKey.values()].sort((a, b) => compare(a, b, order));
  return { findings, provenance };
}

/** @param {Issue} issue */
function dedupeKey(issue) {
  const a = issue.anchor;
  if (!a) return `evidence:${issue.id}`;
  const repl = issue.replacements.map((r) => r.text).sort().join('\u0000');
  return `${a.blockId}:${a.from}:${a.to}:${repl || issue.category}`;
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
