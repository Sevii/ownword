// Validate model output before anything is shown as a result or applied
// (docs/automated-text-review-design.md §6–7). Invalid JSON or a malformed
// top level fails the run; individually invalid findings are discarded and
// counted; a rewrite must account for exactly the editable blocks.

import { resolveEvidence } from '../analysis/edits/resolve-evidence.js';
import { createEnvelope } from '../analysis/issues/envelope.js';

const CATEGORIES = new Set([
  'spelling', 'grammar', 'punctuation', 'capitalization', 'word-choice', 'repetition', 'conciseness',
  'sentence-length', 'readability', 'passive-voice', 'hedging', 'tone', 'clarity', 'consistency', 'other',
]);
// Control characters and line/paragraph separators never belong in block text.
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u2028\u2029]/u;
export const MAX_FINDINGS = 20;
const MAX_MESSAGE = 2000;
const MAX_REPLACEMENT = 2000;
const MAX_SUMMARY = 600;
export const MAX_EXPLANATION = 4000;

/**
 * Parse a model's JSON reply, tolerating a Markdown code fence around it.
 * @param {string} text
 * @returns {Record<string, any> | null}
 */
export function parseModelJson(text) {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  if (fence) t = fence[1];
  try {
    const v = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, any> | null} out parsed reply
 * @param {{ snapshot: import('../analysis/types.js').Snapshot, editableBlockIds: string[] }} ctx
 * @returns {{ ok: true, blocks: { id: string, text: string }[] } | { ok: false, message: string }}
 */
export function validateRewrite(out, { snapshot, editableBlockIds }) {
  if (!out || !Array.isArray(out.blocks)) return { ok: false, message: 'The AI reply was not a rewrite this editor can read.' };
  const wanted = new Set(editableBlockIds);
  const byId = new Map();
  for (const b of out.blocks) {
    if (!b || typeof b.id !== 'string' || typeof b.text !== 'string') return { ok: false, message: 'The rewrite had a malformed block.' };
    if (!wanted.has(b.id)) return { ok: false, message: 'The rewrite changed text outside the chosen passage.' };
    if (byId.has(b.id)) return { ok: false, message: 'The rewrite returned the same block twice.' };
    byId.set(b.id, b.text);
  }
  const missing = editableBlockIds.filter((id) => !byId.has(id));
  // A missing block is not permission to delete it.
  if (missing.length) return { ok: false, message: `The rewrite left out ${missing.length} of the chosen ${missing.length === 1 ? 'paragraph' : 'paragraphs'}.` };
  const source = new Map(snapshot.blocks.map((b) => [b.id, b.text]));
  const blocks = [];
  for (const id of editableBlockIds) {
    // Blocks are single lines; a model's line breaks become spaces.
    const text = byId.get(id).replace(/\s*\r?\n\s*/gu, ' ').trim();
    if (UNSAFE.test(text)) return { ok: false, message: 'The rewrite contained characters that cannot be placed in the document.' };
    const before = source.get(id) ?? '';
    if (text.length > Math.max(before.length * 4, before.length + 2000)) return { ok: false, message: 'The rewrite was far longer than the original, so it was not used.' };
    if (!text && before.trim()) return { ok: false, message: 'The rewrite emptied a paragraph. Deleting text needs an explicit request.' };
    blocks.push({ id, text });
  }
  return { ok: true, blocks };
}

/**
 * Turn a findings reply into an envelope of anchored AI issues.
 * @param {Record<string, any> | null} out
 * @param {{ snapshot: import('../analysis/types.js').Snapshot, editableBlockIds: string[], contextBlockIds: string[],
 *   scopeKind: 'selection'|'document', requestId: string, action: string, provider: string, model: string,
 *   promptVersion?: string }} ctx
 * @returns {{ ok: true, envelope: import('../analysis/types.js').Envelope } | { ok: false, message: string }}
 */
export function findingsEnvelope(out, ctx) {
  if (!out || !Array.isArray(out.findings)) return { ok: false, message: 'The AI reply was not a review this editor can read.' };
  const { snapshot } = ctx;
  const origin = {
    kind: 'ai',
    engine: ctx.provider,
    engineVersion: ctx.model,
    ruleId: `ai-${ctx.action}`,
    requestId: ctx.requestId,
    model: ctx.model,
    ...(ctx.promptVersion ? { promptVersion: ctx.promptVersion } : {}),
  };
  const findings = [];
  const seen = new Set();
  let rejected = 0;
  const limitations = [];
  if (out.findings.length > MAX_FINDINGS) limitations.push(`Only the first ${MAX_FINDINGS} findings are shown.`);
  for (const [i, f] of out.findings.slice(0, MAX_FINDINGS).entries()) {
    const ev = Array.isArray(f?.evidence) ? f.evidence[0] : null;
    const evidence = ev && typeof ev.blockId === 'string' && typeof ev.quote === 'string'
      ? { blockId: ev.blockId, quote: ev.quote, ...(typeof ev.before === 'string' && ev.before ? { before: ev.before } : {}), ...(typeof ev.after === 'string' && ev.after ? { after: ev.after } : {}) }
      : null;
    const resolved = evidence ? resolveEvidence(snapshot, evidence, { allowedBlockIds: ctx.editableBlockIds }) : { ok: false };
    if (!resolved.ok) {
      rejected++;
      continue;
    }
    const { anchor } = resolved;
    const key = `${anchor.blockId}:${anchor.from}-${anchor.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const replacement = typeof f.replacement === 'string' && f.replacement.length <= MAX_REPLACEMENT && !UNSAFE.test(f.replacement) && f.replacement !== anchor.expectedText
      ? f.replacement
      : null;
    const message = String(f.rationale ?? '').trim().slice(0, MAX_MESSAGE) || 'Suggested by AI review.';
    findings.push({
      contractVersion: 1,
      id: `ai:${ctx.requestId}:${i}`,
      documentId: snapshot.documentId,
      sourceRevision: snapshot.revision,
      settingsRevision: snapshot.settingsRevision,
      origin,
      category: CATEGORIES.has(f.category) ? f.category : 'other',
      classification: f.severity === 'error' ? 'likely-error' : 'style',
      severity: f.severity === 'error' ? 'meaningful' : 'minor',
      // The contract carries a resolved anchor or unresolved evidence, never
      // both; the model's quote is the anchor's expectedText.
      anchor,
      message,
      replacements: replacement === null ? [] : [{ text: replacement }],
      state: 'current',
    });
  }
  if (out.findings.length > 0 && findings.length === 0 && rejected > 0) {
    return { ok: false, message: 'Review could not be validated: none of its findings matched the text exactly.' };
  }
  const summary = typeof out.summary === 'string' && out.summary.trim() ? out.summary.trim().slice(0, MAX_SUMMARY) : undefined;
  const envelope = createEnvelope(snapshot, {
    requestId: ctx.requestId,
    coverage: {
      requestedScope: ctx.scopeKind,
      analyzedBlockIds: ctx.editableBlockIds,
      contextBlockIds: ctx.contextBlockIds,
      modes: [ctx.action],
      limitations,
    },
    findings,
    rejectedFindingCount: rejected,
    summary,
  });
  return { ok: true, envelope };
}

/** Plain-text explanations: trimmed and capped. */
export function cleanExplanation(text) {
  const t = text.replace(UNSAFE, '').trim();
  return t.length > MAX_EXPLANATION ? `${t.slice(0, MAX_EXPLANATION)}…` : t;
}
