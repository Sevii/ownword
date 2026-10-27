// Review envelopes. Local checks and AI reviews both produce this shape, so
// the suggestion panel has one input type.

/**
 * @typedef {import('../types.js').Envelope} Envelope
 * @typedef {import('../types.js').Snapshot} Snapshot
 * @typedef {import('../types.js').Issue} Issue
 * @typedef {import('../types.js').Coverage} Coverage
 */

/**
 * @param {Snapshot} snapshot
 * @param {{ requestId: string, status?: Envelope['status'], coverage: Partial<Coverage>,
 *   findings: Issue[], rejectedFindingCount?: number, summary?: string }} parts
 * @returns {Envelope}
 */
export function createEnvelope(snapshot, parts) {
  const coverage = {
    requestedScope: parts.coverage.requestedScope ?? 'document',
    analyzedBlockIds: parts.coverage.analyzedBlockIds ?? [],
    contextBlockIds: parts.coverage.contextBlockIds ?? [],
    modes: parts.coverage.modes ?? [],
    partial: parts.coverage.partial ?? false,
    limitations: [...(parts.coverage.limitations ?? [])],
  };
  const rejected = parts.rejectedFindingCount ?? 0;
  if (rejected > 0) {
    coverage.limitations.push(`${rejected} ${rejected === 1 ? 'finding' : 'findings'} failed validation and ${rejected === 1 ? 'was' : 'were'} discarded.`);
  }
  return {
    contractVersion: 1,
    requestId: parts.requestId,
    documentId: snapshot.documentId,
    sourceRevision: snapshot.revision,
    settingsRevision: snapshot.settingsRevision,
    status: parts.status ?? 'completed',
    coverage,
    summary: parts.summary ?? summarize(parts.findings, coverage),
    findings: parts.findings,
    rejectedFindingCount: rejected,
  };
}

/** @param {Issue[]} findings @param {Coverage} coverage */
function summarize(findings, coverage) {
  const errors = findings.filter((f) => f.classification === 'likely-error').length;
  const other = findings.length - errors;
  const scope = coverage.partial ? 'the checked part of the document' : 'the checked scope';
  if (!findings.length) return `No suggestions for ${scope}.`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(errors, 'likely error')} and ${plural(other, 'style suggestion')} in ${scope}.`;
}
