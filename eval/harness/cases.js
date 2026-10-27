// Load and validate eval cases (docs/foundation-build-plan.md §5.1).
// Cases cite quotes, not offsets; they resolve through the production
// resolveEvidence, so an unresolvable or ambiguous quote is a case error.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotFromMarkdown } from '../../frontend/src/analysis/snapshot/from-markdown.js';
import { resolveEvidence } from '../../frontend/src/analysis/edits/resolve-evidence.js';

export const EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const CATEGORIES = new Set([
  'spelling', 'grammar', 'punctuation', 'capitalization', 'word-choice', 'repetition', 'conciseness',
  'sentence-length', 'readability', 'passive-voice', 'hedging', 'tone', 'clarity', 'consistency', 'other',
]);
const CLASSIFICATIONS = new Set(['likely-error', 'style', 'review-question']);
const GENRES = new Set(['email', 'post', 'document', 'message', 'essay']);

/**
 * @typedef {{ block: number, quote: string, before?: string, after?: string, category: string,
 *   classification: string, accept?: string[] }} ExpectedIssue
 * @typedef {{ id: string, source: { kind: string, author: string, license: string },
 *   genre: string, dialect: string, audience?: string, goals?: { formality?: string }, markdown: string,
 *   expected: ExpectedIssue[], optional: ExpectedIssue[], forbiddenChanges: string[], clean: boolean,
 *   labels: { reviewers: number, notes?: string } }} EvalCase
 */

/**
 * @param {'dev'|'heldout'} split
 * @returns {{ file: string, case: EvalCase }[]}
 */
export function loadCases(split) {
  const dir = join(EVAL_DIR, 'corpus', split);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: join(split, f), case: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

/**
 * Validate a case and resolve its quotes. Returns the snapshot and resolved
 * anchors, or a list of problems.
 * @param {EvalCase} c
 */
export function prepareCase(c) {
  const problems = [];
  for (const key of ['id', 'source', 'genre', 'dialect', 'markdown', 'expected', 'optional', 'forbiddenChanges', 'clean', 'labels']) {
    if (!(key in c)) problems.push(`missing field ${key}`);
  }
  if (problems.length) return { problems };
  if (!GENRES.has(c.genre)) problems.push(`unknown genre ${c.genre}`);
  if (c.clean && c.expected.length) problems.push('clean case has expected issues');
  const snapshot = snapshotFromMarkdown(c.markdown, { documentId: c.id });
  const resolve = (/** @type {ExpectedIssue} */ e, kind) => {
    if (!CATEGORIES.has(e.category)) problems.push(`${kind} "${e.quote}": unknown category ${e.category}`);
    if (!CLASSIFICATIONS.has(e.classification)) problems.push(`${kind} "${e.quote}": unknown classification ${e.classification}`);
    const block = snapshot.blocks[e.block];
    if (!block) {
      problems.push(`${kind} "${e.quote}": no block ${e.block}`);
      return null;
    }
    const r = resolveEvidence(snapshot, { blockId: block.id, quote: e.quote, before: e.before, after: e.after });
    if (!r.ok) {
      problems.push(`${kind} "${e.quote}" in block ${e.block}: ${r.reason}`);
      return null;
    }
    return { ...e, anchor: r.anchor };
  };
  const expected = c.expected.map((e) => resolve(e, 'expected'));
  const optional = c.optional.map((e) => resolve(e, 'optional'));
  for (const f of c.forbiddenChanges) {
    if (!snapshot.blocks.some((b) => b.text.includes(f))) problems.push(`forbidden change "${f}" not in text`);
  }
  if (problems.length) return { problems };
  return { snapshot, expected, optional, problems };
}
