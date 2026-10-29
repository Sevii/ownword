import { useEffect, useRef, useState } from 'react';
import { IssueBody } from './IssueCard.jsx';
import { IconCheck, IconClose, IconLock } from './icons.jsx';

const FILTERS = [
  ['all', 'All'],
  ['error', 'Errors'],
  ['style', 'Style'],
];

/**
 * The review panel: a Suggestions tab (summary, filters, suggestion cards,
 * document stats) and an AI tab (props.aiPanel). Selecting a card moves the
 * document view to its text (onSelect).
 */
export function AssistPanel(props) {
  const { findings, activeId, isStale, onSelect, checkStatus, summary, profile, open, onClose } = props;
  const [filter, setFilter] = useState('all');
  const listRef = useRef(null);
  const errors = findings.filter((f) => f.classification === 'likely-error');
  const style = findings.length - errors.length;
  const shown = filter === 'all' ? findings : findings.filter((f) => (filter === 'error') === (f.classification === 'likely-error'));

  // Keep the active card in view when it changes from the document side.
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    listRef.current.querySelector(`[data-card="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  function onKeyDown(e) {
    const cards = [...listRef.current.querySelectorAll('[data-card]')];
    const i = cards.indexOf(document.activeElement?.closest('[data-card]'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = cards[Math.min(cards.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) {
        next.focus();
        onSelect(next.dataset.card);
      }
    } else if (e.key === 'Enter' && i >= 0) {
      onSelect(cards[i].dataset.card);
    } else if (e.key === 'Escape') {
      props.onReturnFocus();
    }
  }

  const busy = checkStatus === 'checking' || checkStatus === 'waiting';
  const statusPill =
    checkStatus === 'current' ? <span className="pill pill--ok">Checked on this device</span>
    : busy ? <span className="pill pill--busy">Checking…</span>
    : checkStatus === 'paused' ? <span className="pill">Paused</span>
    : checkStatus === 'unavailable' || checkStatus === 'failed' ? <span className="pill pill--error">Checking unavailable</span>
    : <span className="pill">Starting…</span>;

  return (
    <aside className={`assist${open ? ' assist--open' : ''}`} aria-label="Review">
      <button type="button" className="icon-btn assist__close" aria-label="Close review" onClick={onClose}>
        <IconClose />
      </button>

      <div className="tabs" role="tablist" aria-label="Review panel">
        <button type="button" role="tab" id="tab-suggestions" aria-selected={props.tab === 'suggestions'} aria-controls="tabpanel-review" onClick={() => props.onTab('suggestions')}>
          Suggestions <span className="tabs__count">{findings.length}</span>
        </button>
        <button type="button" role="tab" id="tab-ai" aria-selected={props.tab === 'ai'} aria-controls="tabpanel-review" onClick={() => props.onTab('ai')}>
          AI{props.aiBusy ? <span className="tabs__dot" aria-label="working" /> : null}
        </button>
      </div>

      <div id="tabpanel-review" role="tabpanel" aria-labelledby={props.tab === 'ai' ? 'tab-ai' : 'tab-suggestions'}>
      {props.tab === 'ai' ? props.aiPanel : (
      <>

      <div className="panel">
        <div className="score">
          <span className={`score__big${errors.length === 0 ? ' score__big--zero' : ''}`}>{errors.length}</span>
          <span className="score__label">
            <strong>{errors.length === 1 ? 'likely error' : 'likely errors'}</strong>
            <br />
            {style} style {style === 1 ? 'suggestion' : 'suggestions'}
          </span>
        </div>
        <div className="score__status">
          {statusPill}
          {(checkStatus === 'unavailable' || checkStatus === 'failed') && (
            <button type="button" className="btn btn--sm btn--secondary" onClick={props.onRetry}>Retry</button>
          )}
        </div>
      </div>

      {findings.length > 0 ? (
        <>
          <div className="filters" role="group" aria-label="Show">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" className="filter" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
                <span>{key === 'all' ? findings.length : key === 'error' ? errors.length : style}</span>
              </button>
            ))}
          </div>
          <ul className="cards" ref={listRef} onKeyDown={onKeyDown} aria-label="Suggestions">
            {shown.map((issue) => {
              const active = issue.id === activeId;
              return (
                <li
                  key={issue.id}
                  data-card={issue.id}
                  tabIndex={0}
                  aria-current={active ? 'true' : undefined}
                  className={`sg${active ? ' sg--active' : ''}${isStale(issue) ? ' sg--stale' : ''}`}
                  onClick={() => onSelect(issue.id)}
                >
                  <IssueBody issue={issue} stale={isStale(issue)} showActions={active} {...props} />
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="panel empty">
          {checkStatus === 'current' ? (
            <>
              <div className="empty__mark"><IconCheck /></div>
              <h3>Nothing to flag</h3>
              <p className="panel-note">{summary}</p>
            </>
          ) : (
            <p className="panel-note">{summary}</p>
          )}
        </div>
      )}

      {profile?.outline?.length > 0 && (
        <div className="section">
          <p className="eyebrow">Outline</p>
          <ul className="outline" aria-label="Outline">
            {profile.outline.map((h) => (
              <li key={h.id} className={`outline__item outline__item--${h.level}`}>
                <button type="button" className="outline__link" onClick={() => props.onOutlineSelect?.(h.pos)}>{h.text}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {profile && <Stats profile={profile} />}
      </>
      )}
      </div>

      <div className="section">
        <p className="eyebrow">Privacy</p>
        <div className="panel privacy">
          <IconLock />
          <p className="panel-note">Proofreading runs in this browser. Your writing stays on this device unless you start an AI action. <a href={`${import.meta.env.BASE_URL}privacy/`} target="_blank" rel="noopener">Details</a></p>
        </div>
      </div>
    </aside>
  );
}

function Stats({ profile }) {
  const c = profile.counts;
  const r = profile.readability;
  const score = r.score === null ? null : Math.max(0, Math.min(100, r.score));
  const label = score === null ? '' : score >= 70 ? 'Easy to read' : score >= 50 ? 'Fairly standard' : score >= 30 ? 'Fairly difficult' : 'Difficult';
  return (
    <div className="section">
      <p className="eyebrow">This document</p>
      <div className="panel">
        <dl className="stats">
          <div><dt>Words</dt><dd>{c.words.toLocaleString()}</dd></div>
          <div><dt>Reading time</dt><dd>{Math.max(1, Math.round(c.readingMinutes))} min</dd></div>
          <div><dt>Sentences</dt><dd>{c.sentences.toLocaleString()}</dd></div>
          <div><dt>Avg. sentence</dt><dd>{Math.round(profile.sentenceLengths.mean)} words</dd></div>
        </dl>
        {score !== null && (
          <div className="meter" title={`${r.measure}; higher is easier. ${r.stable ? '' : 'Short samples are unreliable.'}`}>
            <div className="meter__top">
              <span>Readability · {label}{r.stable ? '' : ' (short sample)'}</span>
              <b>{Math.round(score)}</b>
            </div>
            <div className="meter__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(score)} aria-label="Readability">
              <Fill pct={score} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Width set through the CSSOM (allowed by the CSP), not a style attribute.
function Fill({ pct }) {
  return <span ref={(el) => el && (el.style.width = `${pct}%`)} />;
}
