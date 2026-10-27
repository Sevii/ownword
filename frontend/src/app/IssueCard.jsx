import { CATEGORY_LABELS } from './labels.js';

/** Engine messages use Markdown code spans for quoted words; show them as quotes. */
export function formatMessage(message) {
  return message.replace(/`([^`]+)`/gu, '“$1”');
}

/**
 * The body of one suggestion, shared by the review panel and the inline popover.
 * @param {{ issue: import('../analysis/types.js').Issue, stale: boolean, showActions: boolean,
 *   onAccept: Function, onDismiss: Function, onAddWord: Function, onDisableRule: Function, onReport: Function }} props
 */
export function IssueBody({ issue, stale, showActions, onAccept, onDismiss, onAddWord, onDisableRule, onReport }) {
  const source = issue.anchor?.expectedText ?? '';
  const kind = issue.classification === 'likely-error' ? 'error' : 'style';
  const first = issue.replacements[0];
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  return (
    <>
      <div className="sg__head">
        <span className={`pill sg__cat--${kind}`}>{CATEGORY_LABELS[issue.category] ?? issue.category}</span>
        {issue.origin.kind === 'ai' && <span className="pill sg__ai" title={`From ${issue.origin.model ?? 'AI'} review`}>AI</span>}
        {stale && <span className="pill pill--busy">Updating</span>}
      </div>
      {source.trim() ? (
        <p className="sg__source">
          <span>{source.length > 90 ? `${source.slice(0, 87)}…` : source}</span>
          {first && (
            <>
              <span className="sg__arrow" aria-label="change to">→</span>
              <span className="sg__fix">{first.text || '(remove)'}</span>
            </>
          )}
        </p>
      ) : (
        <p className="sg__source sg__gap">Missing word or punctuation here</p>
      )}
      <p className="sg__message">{formatMessage(issue.message)}</p>
      {showActions && (
        <div className="sg__actions">
          {issue.replacements.map((r) => (
            <button key={r.text} type="button" className="btn btn--sm" disabled={stale} onClick={stop(() => onAccept(issue, r.text))}>
              {r.text ? <>Use “{r.text}”</> : 'Remove'}
            </button>
          ))}
          <button type="button" className="btn btn--sm btn--secondary" onClick={stop(() => onDismiss(issue))}>
            Dismiss
          </button>
          {issue.category === 'spelling' && source.trim() && (
            <button type="button" className="btn btn--sm btn--ghost" onClick={stop(() => onAddWord(source))}>
              Add to dictionary
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={stop(() => onDisableRule(issue))}>
            Turn off this check
          </button>
          <button type="button" className="btn btn--sm btn--ghost" title="Hide this incorrect suggestion on this device." onClick={stop(() => onReport(issue))}>
            Mark as incorrect
          </button>
        </div>
      )}
    </>
  );
}
