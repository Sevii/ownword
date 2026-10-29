import { useEffect, useRef } from 'react';
import { IconExport, IconFocus, IconMenu, IconSettings, IconTarget } from './icons.jsx';
import { SAVE_STATUS_LABELS } from './labels.js';

const FORMALITY = [
  ['casual', 'Casual'],
  ['neutral', 'Neutral'],
  ['formal', 'Formal'],
];

/** Close an open <details> menu when clicking elsewhere or pressing Escape. */
function useDismissableMenu() {
  const ref = useRef(/** @type {HTMLDetailsElement | null} */ (null));
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.open && !ref.current.contains(e.target)) ref.current.open = false;
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return ref;
}

/**
 * @param {{ title: string, onTitle: (t: string) => void, saveStatus: string, goals: any,
 *   onGoals: (g: object) => void, onExport: (k: string) => void, onSettings: () => void,
 *   drawerOpen: boolean, onToggleDrawer: () => void, focusMode: boolean, onToggleFocus: () => void }} props
 */
export function Topbar(props) {
  const goalsRef = useDismissableMenu();
  const exportRef = useDismissableMenu();
  const s = props.saveStatus === 'conflict-clean' ? 'saved' : props.saveStatus;
  const savePill =
    s === 'saved' ? 'pill--ok' : s === 'saving' || s === 'unsaved' ? 'pill--busy' : 'pill--error';
  const exportAs = (kind) => {
    if (exportRef.current) exportRef.current.open = false;
    props.onExport(kind);
  };

  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Documents" aria-expanded={props.drawerOpen} onClick={props.onToggleDrawer}>
        <IconMenu />
      </button>
      <span className="brand">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
        <span className="brand__name">Open Writer</span>
      </span>
      <span className="topbar__sep" />
      <input className="doc-title" aria-label="Document title" value={props.title} placeholder="Untitled" onChange={(e) => props.onTitle(e.target.value)} />
      <span className={`pill ${savePill} status__save status__save--${s}`} role="status">{SAVE_STATUS_LABELS[s]}</span>
      <span className="topbar__spacer" />
      <div className="topbar__actions">
        <details className="menu" ref={goalsRef}>
          <summary className="icon-btn" aria-label="Writing goals">
            <IconTarget />
            <span className="icon-btn__label">Goals</span>
          </summary>
          <div className="menu__body menu__body--form">
            <p className="eyebrow">Writing goals</p>
            <div className="field">
              <span>Formality</span>
              <div className="segmented" role="group" aria-label="Formality">
                {FORMALITY.map(([v, label]) => (
                  <button key={v} type="button" aria-pressed={(props.goals.formality ?? 'neutral') === v} onClick={() => props.onGoals({ formality: v })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Audience</span>
              <input value={props.goals.audience ?? ''} placeholder="e.g. a client" onChange={(e) => props.onGoals({ audience: e.target.value })} />
            </label>
            <label className="field">
              <span>Intent</span>
              <input value={props.goals.intent ?? ''} placeholder="e.g. ask for a decision" onChange={(e) => props.onGoals({ intent: e.target.value })} />
            </label>
            <p className="muted">Casual writing skips capitalization checks on sentence starts.</p>
          </div>
        </details>
        <details className="menu" ref={exportRef}>
          <summary className="icon-btn" aria-label="Export">
            <IconExport />
            <span className="icon-btn__label">Export</span>
          </summary>
          <div className="menu__body">
            <button type="button" className="menu__item" onClick={() => exportAs('copy')}>Copy text</button>
            <button type="button" className="menu__item" onClick={() => exportAs('share')}>Copy share link <small>text in the link</small></button>
            <button type="button" className="menu__item" onClick={() => exportAs('docx')}>Word document <small>.docx</small></button>
            <button type="button" className="menu__item" onClick={() => exportAs('md')}>Markdown <small>.md</small></button>
            <button type="button" className="menu__item" onClick={() => exportAs('txt')}>Plain text <small>.txt</small></button>
            <button type="button" className="menu__item" onClick={() => exportAs('print')}>Print or save as PDF</button>
          </div>
        </details>
        <button type="button" className="icon-btn topbar__focus" aria-label="Focus mode" aria-pressed={props.focusMode} onClick={props.onToggleFocus}>
          <IconFocus />
          <span className="icon-btn__label">Focus</span>
        </button>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={props.onSettings}>
          <IconSettings />
        </button>
      </div>
    </header>
  );
}
