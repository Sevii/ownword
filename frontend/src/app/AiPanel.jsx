import { useState } from 'react';
import { canApply } from '../ai/review-state.js';
import { previewText } from '../ai/preview.js';
import { PROTECTED_LABELS } from '../ai/rewrite.js';

const PRESETS = [
  ['clarify', 'Clarify'],
  ['shorten', 'Shorten'],
  ['grammar', 'Fix grammar'],
  ['tone', 'Adjust tone'],
];

const RUNNING_LABEL = {
  rewrite: 'Writing a revision…',
  findings: 'Reviewing…',
  explanation: 'Thinking…',
};

/**
 * AI actions on the selection or the whole document, with a streaming
 * preview, validated results, a reviewable diff, and Apply / Undo / Discard.
 * @param {{ ai: ReturnType<typeof import('./useAiReview.js').useAiReview>,
 *   connection: null | { label: string, providerLabel: string },
 *   selectionWords: number, revision: number, goals: any,
 *   onOpenSettings: () => void, onShowSuggestions: () => void }} props
 */
export function AiPanel({ ai, connection, selectionWords, revision, goals, onOpenSettings, onShowSuggestions }) {
  const [scopeChoice, setScopeChoice] = useState('selection');
  const [instruction, setInstruction] = useState('');
  const { state, job } = ai;
  const scope = selectionWords > 0 && scopeChoice === 'selection' ? 'selection' : 'document';
  const busy = state.status === 'running' || state.status === 'validating-output';

  if (!connection) {
    return (
      <div className="panel ai-connect">
        <p className="panel-note">
          Connect your own AI account to rewrite, proofread, or check tone. Your key stays in this browser.
        </p>
        <button type="button" className="btn btn--sm" onClick={onOpenSettings}>Connect an AI provider</button>
      </div>
    );
  }

  const run = (action, opts = {}) => ai.run(action, { scope, ...opts });

  return (
    <div className="ai">
      <div className="panel ai-controls">
        <p className="ai-using">
          Using <strong>{connection.label}</strong> via {connection.providerLabel}{' '}
          <button type="button" className="link-btn" onClick={onOpenSettings}>Change</button>
        </p>
        <div className="segmented ai-scope" role="group" aria-label="Work on">
          <button type="button" aria-pressed={scope === 'selection'} disabled={selectionWords === 0} onClick={() => setScopeChoice('selection')}>
            Selection{selectionWords ? ` · ${selectionWords} words` : ''}
          </button>
          <button type="button" aria-pressed={scope === 'document'} onClick={() => setScopeChoice('document')}>Whole document</button>
        </div>

        <p className="eyebrow ai-label">Improve</p>
        <div className="ai-buttons">
          {PRESETS.map(([preset, label]) => (
            <button key={preset} type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={() => run('improve', { preset })}>
              {label}
            </button>
          ))}
        </div>

        <p className="eyebrow ai-label">Review</p>
        <div className="ai-buttons">
          <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={() => run('proofread')}>Proofread with AI</button>
          <button
            type="button"
            className="btn btn--sm btn--secondary"
            disabled={busy}
            title={goals?.audience ? `For ${goals.audience}` : 'Set Goals for advice about a specific reader'}
            onClick={() => run('tone-audience')}
          >
            Check tone{goals?.audience ? ` for ${goals.audience}` : ''}
          </button>
        </div>

        <label className="ai-label eyebrow" htmlFor="ai-instruction">Ask</label>
        <textarea
          id="ai-instruction"
          className="ai-instruction"
          rows={2}
          maxLength={2000}
          placeholder="Tell the AI what to change, or ask a question"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <div className="ai-buttons">
          <button type="button" className="btn btn--sm" disabled={busy || !instruction.trim()} onClick={() => run('instruct', { instruction })}>
            Rewrite
          </button>
          <button type="button" className="btn btn--sm btn--secondary" disabled={busy || !instruction.trim()} onClick={() => run('explain', { instruction })}>
            Ask a question
          </button>
        </div>
      </div>

      {state.status !== 'idle' && job && (
        <AiResult ai={ai} revision={revision} onShowSuggestions={onShowSuggestions} />
      )}
      <p className="panel-note ai-note">AI results stay in this tab until you apply them; reloading discards them.</p>
    </div>
  );
}

function AiResult({ ai, revision, onShowSuggestions }) {
  const { state, job, applied, explainer } = ai;
  const attribution = `${job.modelLabel} via ${job.providerLabel}`;

  if (state.status === 'running' || state.status === 'validating-output') {
    const text = previewText(job.kind, state.preview);
    return (
      <section className="panel ai-result" aria-live="polite" aria-busy="true">
        <div className="ai-result__head">
          <span className="pill pill--busy">{state.status === 'validating-output' ? 'Checking the result…' : RUNNING_LABEL[job.kind]}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={ai.cancel}>Cancel</button>
        </div>
        {text && <p className="ai-preview">{text}</p>}
        <p className="panel-note">Preview only: nothing changes until you apply it.</p>
      </section>
    );
  }

  if (state.status === 'cancelled') {
    return (
      <section className="panel ai-result">
        <p className="panel-note">Cancelled. The provider may still count the request toward your usage.</p>
        <button type="button" className="btn btn--sm btn--ghost" onClick={ai.discard}>Close</button>
      </section>
    );
  }

  if (state.status === 'failed') {
    const e = state.error ?? { error: 'internal', message: 'Something went wrong.' };
    return (
      <section className="panel ai-result ai-result--failed" role="alert">
        <p className="ai-error">{e.message}</p>
        {e.error === 'unsupported' && <p className="panel-note">Try a different model in Settings.</p>}
        <div className="ai-buttons">
          {e.manageUrl && (
            <a className="btn btn--sm btn--secondary" href={e.manageUrl} target="_blank" rel="noopener noreferrer">Open {job.providerLabel}</a>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={ai.discard}>Close</button>
        </div>
        {state.preview && job.kind === 'rewrite' && <p className="panel-note">The partial response was discarded.</p>}
      </section>
    );
  }

  const result = state.result;
  if (result.kind === 'explanation') {
    return (
      <section className="panel ai-result">
        <p className="ai-explanation">{result.text}</p>
        <Footer attribution={attribution} onClose={ai.discard} />
      </section>
    );
  }

  if (result.kind === 'findings') {
    const env = result.envelope;
    const n = env.findings.length;
    return (
      <section className="panel ai-result">
        <p className="ai-summary">{env.summary}</p>
        <p className="panel-note">
          {n
            ? `${n} ${n === 1 ? 'finding is' : 'findings are'} in Suggestions, marked AI. Any the local checker already found are shown once.`
            : 'No findings for this scope. That does not mean the text is error-free.'}
        </p>
        {env.coverage.limitations.map((l) => <p key={l} className="panel-note">{l}</p>)}
        <div className="ai-buttons">
          {n > 0 && <button type="button" className="btn btn--sm" onClick={onShowSuggestions}>Show suggestions</button>}
        </div>
        <Footer attribution={attribution} onClose={ai.discard} />
      </section>
    );
  }

  // Rewrite proposal.
  const p = result.proposal;
  const fresh = canApply(state, revision);
  const applicable = p.changes.filter((c) => !c.problem);
  const warnings = p.changes.reduce((n, c) => n + c.meaning.removed.length + c.meaning.added.length, 0);

  if (applied) {
    return (
      <section className="panel ai-result">
        <p className="ai-summary">Applied {applicable.length} {applicable.length === 1 ? 'change' : 'changes'}.</p>
        <div className="ai-buttons">
          {applied.revision === revision && <button type="button" className="btn btn--sm btn--secondary" onClick={ai.undoApplied}>Undo</button>}
          <button type="button" className="btn btn--sm btn--ghost" onClick={ai.discard}>Close</button>
        </div>
      </section>
    );
  }

  if (!p.changes.length) {
    return (
      <section className="panel ai-result">
        <p className="ai-summary">No changes suggested.</p>
        <Footer attribution={attribution} onClose={ai.discard} />
      </section>
    );
  }

  return (
    <section className="panel ai-result" aria-label="Proposed changes">
      <p className="ai-summary">
        Proposed changes to {p.changes.length} {p.changes.length === 1 ? 'paragraph' : 'paragraphs'}
        {p.unchanged ? ` (${p.unchanged} unchanged)` : ''}
      </p>
      {warnings > 0 && (
        <p className="callout ai-warning">
          Check the highlighted details: this revision changes {warnings === 1 ? 'something' : 'things'} that often change meaning.
        </p>
      )}
      <ol className="ai-changes">
        {p.changes.map((c) => (
          <li key={c.blockId} className={`ai-change${c.problem ? ' ai-change--blocked' : ''}`}>
            <p className="ai-diff">
              {c.parts.map((part, i) =>
                part.op === 'equal' ? <span key={i}>{part.text}</span>
                : part.op === 'delete' ? <del key={i}>{part.text}</del>
                : <ins key={i}>{part.text}</ins>,
              )}
            </p>
            {(c.meaning.removed.length > 0 || c.meaning.added.length > 0) && (
              <ul className="ai-meaning">
                {c.meaning.removed.map((s, i) => <li key={`r${i}`}>Removes the {PROTECTED_LABELS[s.kind] ?? s.kind} “{s.text}”</li>)}
                {c.meaning.added.map((s, i) => <li key={`a${i}`}>Adds the {PROTECTED_LABELS[s.kind] ?? s.kind} “{s.text}”</li>)}
              </ul>
            )}
            {c.problem && <p className="panel-note ai-blocked">{c.problem}</p>}
          </li>
        ))}
      </ol>
      {!fresh && <p className="callout">The text changed after this was requested, so it can’t be applied. Run the action again.</p>}
      <div className="ai-buttons">
        <button type="button" className="btn btn--sm" disabled={!fresh || !applicable.length} onClick={ai.apply}>
          {applicable.length === p.changes.length ? 'Apply' : `Apply ${applicable.length} of ${p.changes.length}`}
        </button>
        <button type="button" className="btn btn--sm btn--secondary" disabled={explainer?.status === 'running'} onClick={ai.explainChanges}>
          Explain changes
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={ai.discard}>Discard</button>
      </div>
      {explainer && (
        <p className={`ai-explanation${explainer.status === 'failed' ? ' ai-error' : ''}`} aria-live="polite">
          {explainer.text || 'Explaining…'}
        </p>
      )}
      <p className="panel-note">From {attribution}. Review before applying; Undo reverts the whole change.</p>
    </section>
  );
}

function Footer({ attribution, onClose }) {
  return (
    <div className="ai-footer">
      <span className="panel-note">From {attribution}</span>
      <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>Close</button>
    </div>
  );
}
