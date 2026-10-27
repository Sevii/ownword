// Runs explicit AI actions: captures the scope and snapshot, streams the
// request directly to the provider, validates the result, and applies a rewrite as
// one undoable transaction. One action at a time; results live in memory only.

import { useReducer, useRef, useState } from 'react';
import { runAiRequest } from '../ai/client.js';
import { reviewReducer, INITIAL, canApply } from '../ai/review-state.js';
import { buildScope, scopeBlocks } from '../ai/scope.js';
import { parseModelJson, validateRewrite, findingsEnvelope, cleanExplanation } from '../ai/validate.js';
import { proposeRewrite } from '../ai/rewrite.js';
import { applyEdits } from '../editor/apply-edit.js';
import { count } from './telemetry.js';

/** @typedef {'improve'|'instruct'|'tone-audience'|'explain'|'proofread'} Action */

export const OUTPUT_KIND = {
  improve: 'rewrite',
  instruct: 'rewrite',
  proofread: 'findings',
  'tone-audience': 'findings',
  explain: 'explanation',
};

/**
 * @param {{ editorRef: { current: any }, currentRequest: () => any, revisionRef: { current: number },
 *   settingsRevRef: { current: number }, docRef: { current: any },
 *   connection: null | { provider: string, model: string, key: string, label: string, providerLabel: string },
 *   onFindings: (issues: any[], action: Action) => void, onApplied?: () => void, announce: (msg: string) => void }} deps
 */
export function useAiReview(deps) {
  const [state, dispatch] = useReducer(reviewReducer, INITIAL);
  const [job, setJob] = useState(/** @type {any} */ (null));
  const [applied, setApplied] = useState(/** @type {null | { revision: number }} */ (null));
  const [explainer, setExplainer] = useState(/** @type {null | { status: string, text: string }} */ (null));
  const abortRef = useRef(/** @type {AbortController | null} */ (null));
  const explainAbortRef = useRef(/** @type {AbortController | null} */ (null));
  const requestIdRef = useRef(/** @type {string | null} */ (null));
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /**
   * @param {Action} action
   * @param {{ scope: 'selection'|'document', preset?: string, instruction?: string }} opts
   */
  async function run(action, opts) {
    const d = depsRef.current;
    const conn = d.connection;
    const req = d.currentRequest();
    const editor = d.editorRef.current;
    if (!conn || !req || !editor) return;
    const sel = editor.state.selection;
    const scope = buildScope(req.snapshot, req.positions, opts.scope === 'selection' ? { from: sel.from, to: sel.to } : null);
    if (scope.empty) {
      d.announce('There is no text to work on in that scope.');
      return;
    }
    if (scope.tooLarge) {
      d.announce('That is more than 5,000 words. Select a smaller passage.');
      return;
    }
    abortRef.current?.abort();
    stopExplaining();
    const clientRequestId = crypto.randomUUID();
    const goals = d.docRef.current?.goals ?? {};
    const body = {
      contractVersion: 1,
      clientRequestId,
      provider: conn.provider,
      model: conn.model,
      action,
      sourceRevision: req.snapshot.revision,
      blocks: scopeBlocks(req.snapshot, scope),
      editableBlockIds: scope.editableBlockIds,
      ...(goalsFor(goals) ? { goals: goalsFor(goals) } : {}),
      ...(opts.instruction?.trim() ? { instruction: opts.instruction.trim().slice(0, 2000) } : {}),
      ...(opts.preset ? { preset: opts.preset } : {}),
    };
    const thisJob = {
      clientRequestId,
      action,
      preset: opts.preset ?? null,
      instruction: opts.instruction?.trim() ?? '',
      kind: OUTPUT_KIND[action],
      scope,
      snapshot: req.snapshot,
      provider: conn.provider,
      providerLabel: conn.providerLabel,
      model: conn.model,
      modelLabel: conn.label,
      promptVersion: '',
    };
    setJob(thisJob);
    setApplied(null);
    setExplainer(null);
    dispatch({ type: 'start', clientRequestId, sourceRevision: req.snapshot.revision });
    count(`ai.request.started.${action}`);
    const abort = new AbortController();
    abortRef.current = abort;
    requestIdRef.current = null;

    const { terminal } = await runAiRequest(body, {
      key: conn.key,
      signal: abort.signal,
      onEvent: (e) => {
        if (e.type === 'started') {
          requestIdRef.current = e.requestId;
          thisJob.promptVersion = e.promptVersion ?? '';
        }
        dispatch({ type: 'event', clientRequestId, event: e });
      },
    });
    if (abortRef.current === abort) abortRef.current = null;
    if (terminal.type === 'failed') count(`ai.request.failed.${terminal.error}`);
    if (terminal.type !== 'completed') return;
    count(`ai.request.completed.${action}`);
    dispatch({ type: 'validated', clientRequestId, ...validate(thisJob, terminal.text, requestIdRef.current ?? clientRequestId) });
  }

  function validate(j, text, requestId) {
    if (j.kind === 'explanation') {
      const t = cleanExplanation(text);
      return t ? { ok: true, result: { kind: 'explanation', text: t } } : { ok: false, message: 'The AI returned an empty answer.' };
    }
    const out = parseModelJson(text);
    if (j.kind === 'rewrite') {
      const v = validateRewrite(out, { snapshot: j.snapshot, editableBlockIds: j.scope.editableBlockIds });
      if (!v.ok) return v;
      return { ok: true, result: { kind: 'rewrite', proposal: proposeRewrite(j.snapshot, v.blocks) } };
    }
    const v = findingsEnvelope(out, {
      snapshot: j.snapshot,
      editableBlockIds: j.scope.editableBlockIds,
      contextBlockIds: j.scope.contextBlockIds,
      scopeKind: j.scope.kind,
      requestId,
      action: j.action,
      provider: j.provider,
      model: j.model,
      promptVersion: j.promptVersion || undefined,
    });
    if (!v.ok) return v;
    depsRef.current.onFindings(v.envelope.findings, j.action);
    return { ok: true, result: { kind: 'findings', envelope: v.envelope } };
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: 'cancel' });
    count('ai.request.cancelled');
  }

  /** Apply the proposal's applicable edits as one undo step. */
  function apply() {
    const d = depsRef.current;
    const editor = d.editorRef.current;
    const proposal = state.result?.proposal;
    if (!editor || !proposal || !canApply(state, d.revisionRef.current)) return { ok: false, reason: 'stale' };
    const res = applyEdits(
      editor,
      { documentId: job.snapshot.documentId, revision: d.revisionRef.current, settingsRevision: d.settingsRevRef.current },
      proposal.edits,
      { meta: `ai:${job.clientRequestId}` },
    );
    if (res.ok) {
      setApplied({ revision: d.revisionRef.current });
      count(`ai.result.applied.${job.action}`);
      d.onApplied?.();
      d.announce('AI changes applied. Undo is available.');
    } else {
      d.announce('The text changed, so the changes were not applied. Run the action again.');
    }
    return res;
  }

  function undoApplied() {
    const editor = depsRef.current.editorRef.current;
    if (editor && applied && applied.revision === depsRef.current.revisionRef.current) {
      editor.commands.undo();
      setApplied(null);
    }
  }

  function discard() {
    if (job && state.status === 'completed' && !applied) count(`ai.result.dismissed.${job.action}`);
    abortRef.current?.abort();
    stopExplaining();
    dispatch({ type: 'reset' });
    setJob(null);
    setApplied(null);
    setExplainer(null);
  }

  /** Ask the model to explain a completed rewrite, comparing old and new text. */
  async function explainChanges() {
    const d = depsRef.current;
    const proposal = state.result?.proposal;
    const conn = d.connection;
    if (!proposal || !conn || !job) return;
    const changed = proposal.changes;
    const blocks = [
      ...changed.map((c) => ({ id: c.blockId, type: c.type, text: c.before })),
      ...changed.map((c) => ({ id: `proposed-${c.blockId}`, type: 'proposed', text: c.after })),
    ];
    stopExplaining();
    const abort = new AbortController();
    explainAbortRef.current = abort;
    setExplainer({ status: 'running', text: '' });
    const { terminal } = await runAiRequest(
      {
        contractVersion: 1,
        clientRequestId: crypto.randomUUID(),
        provider: conn.provider,
        model: conn.model,
        action: 'explain',
        sourceRevision: job.snapshot.revision,
        blocks,
        editableBlockIds: changed.map((c) => c.blockId),
        instruction: 'Explain the proposed changes in a few short sentences.',
      },
      {
        key: conn.key,
        signal: abort.signal,
        onEvent: (e, preview) => !abort.signal.aborted && e.type === 'delta' && setExplainer({ status: 'running', text: preview }),
      },
    );
    // A discard, a new action, or a document switch since then: this explanation belongs to nothing shown.
    if (abort.signal.aborted) return;
    explainAbortRef.current = null;
    setExplainer(
      terminal.type === 'completed'
        ? { status: 'done', text: cleanExplanation(terminal.text) }
        : { status: 'failed', text: terminal.message ?? 'The explanation did not finish.' },
    );
  }

  function stopExplaining() {
    explainAbortRef.current?.abort();
    explainAbortRef.current = null;
  }

  /** Forget everything (switching documents). */
  function reset() {
    abortRef.current?.abort();
    abortRef.current = null;
    stopExplaining();
    dispatch({ type: 'reset' });
    setJob(null);
    setApplied(null);
    setExplainer(null);
  }

  return { state, job, applied, explainer, run, cancel, apply, undoApplied, discard, explainChanges, reset };
}

/** Only the goals the user actually set. */
function goalsFor(goals) {
  const g = {};
  if (goals.audience?.trim()) g.audience = goals.audience.trim().slice(0, 200);
  if (goals.intent?.trim()) g.intent = goals.intent.trim().slice(0, 200);
  if (goals.formality) g.formality = goals.formality;
  return Object.keys(g).length ? g : null;
}
