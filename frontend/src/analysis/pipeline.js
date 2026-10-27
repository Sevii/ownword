// Local analysis pipeline: run engines over a snapshot, validate every
// anchor, apply suppressions, merge, and wrap the result in a review envelope.
// Engines are injected so the eval harness can compare them.

import { issueFromRaw, anchorProblem } from './issues/issue.js';
import { createEnvelope } from './issues/envelope.js';
import { mergeIssues } from './issues/merge.js';
import { applySuppressions } from './issues/dismissals.js';

/**
 * @typedef {import('./types.js').Snapshot} Snapshot
 * @typedef {import('./types.js').Settings} Settings
 * @typedef {import('./types.js').RawFinding} RawFinding
 * @typedef {{ name: string, version: string, setup(): Promise<void>,
 *   run(snapshot: Snapshot, settings: Settings, blockIds?: Set<string>): Promise<{ findings: RawFinding[], rejected: number }> }} Engine
 */

/**
 * @param {Snapshot} snapshot
 * @param {Settings} settings
 * @param {{ engines: Engine[], requestId: string, blockIds?: string[],
 *   suppressions?: import('./issues/dismissals.js').Suppressions }} options
 * @returns {Promise<{ envelope: import('./types.js').Envelope, provenance: Map<string, string[]> }>}
 */
export async function analyze(snapshot, settings, options) {
  const scope = options.blockIds ? new Set(options.blockIds) : undefined;
  const analyzedBlockIds = snapshot.blocks
    .filter((b) => b.type !== 'codeBlock' && (!scope || scope.has(b.id)))
    .map((b) => b.id);
  const limitations = [];
  if (snapshot.blocks.some((b) => b.type === 'codeBlock')) limitations.push('Code blocks are not checked.');

  const issues = [];
  let rejected = 0;
  let failedEngines = 0;
  for (const engine of options.engines) {
    let result;
    try {
      result = await engine.run(snapshot, settings, scope);
    } catch (err) {
      failedEngines++;
      limitations.push(`${engine.name} checks failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    rejected += result.rejected;
    const origin = { kind: /** @type {const} */ ('local'), engine: engine.name, engineVersion: engine.version };
    for (const raw of result.findings) {
      const issue = issueFromRaw(snapshot, raw, origin);
      if (anchorProblem(snapshot, issue.anchor)) rejected++;
      else issues.push(issue);
    }
  }

  const kept = applySuppressions(snapshot, issues, {
    dictionary: settings.dictionary,
    disabledRules: settings.disabledRules,
    ...options.suppressions,
  });
  const { findings, provenance } = mergeIssues(snapshot, kept);
  const allFailed = options.engines.length > 0 && failedEngines === options.engines.length;
  const envelope = createEnvelope(snapshot, {
    requestId: options.requestId,
    status: allFailed ? 'failed' : 'completed',
    coverage: {
      requestedScope: scope ? 'blocks' : 'document',
      analyzedBlockIds,
      modes: options.engines.map((e) => e.name),
      partial: failedEngines > 0,
      limitations,
    },
    findings,
    rejectedFindingCount: rejected,
    ...(allFailed ? { summary: 'Checking is unavailable.' } : {}),
  });
  return { envelope, provenance };
}
