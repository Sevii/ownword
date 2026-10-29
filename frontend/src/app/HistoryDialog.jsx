import { useEffect, useMemo, useRef, useState } from 'react';
import { diffVersions, wordCountOf } from '../documents/history.js';

/**
 * Earlier versions of the open document with a diff against the current
 * text (plan §4.3). Restoring first keeps a copy of the current text.
 * @param {{ open: boolean, onClose: () => void, title: string,
 *   versions: { key: number, savedAt: number, content: object }[],
 *   currentContent: () => object | null, onRestore: (key: number) => Promise<void>, onSaveNow: () => Promise<void> }} props
 */
export function HistoryDialog({ open, onClose, title, versions, currentContent, onRestore, onSaveNow }) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
  const [selected, setSelected] = useState(/** @type {number | null} */ (null));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (open) setSelected(versions[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A version saved while the dialog is open becomes the selection.
  useEffect(() => {
    if (open && (selected === null || !versions.some((v) => v.key === selected))) setSelected(versions[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, open]);

  const version = versions.find((v) => v.key === selected) ?? null;
  const current = open ? currentContent() : null;
  const diff = useMemo(() => (version && current ? diffVersions(version.content, current) : null), [version, current]);
  const interesting = diff ? diff.changes.filter((c) => c.kind !== 'same') : [];

  return (
    <dialog ref={ref} className="dialog dialog--wide" onClose={onClose} aria-labelledby="history-title">
      <form method="dialog" className="dialog__body" onSubmit={(e) => { if (e.nativeEvent.submitter?.value !== 'close') e.preventDefault(); }}>
        <h2 id="history-title">History of “{title || 'Untitled'}”</h2>
        <p className="muted">
          A copy is kept every few minutes while you write, and whenever you restore. Pick one to see what changed since.
        </p>
        <div className="history">
          <ul className="history__list" aria-label="Versions">
            {versions.map((v) => (
              <li key={v.key}>
                <button type="button" className={`history__item${v.key === selected ? ' history__item--on' : ''}`} aria-pressed={v.key === selected} onClick={() => setSelected(v.key)}>
                  <span>{new Date(v.savedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span className="muted">{wordCountOf(v.content).toLocaleString()} words</span>
                </button>
              </li>
            ))}
            {versions.length === 0 && <li className="muted">No earlier versions yet.</li>}
          </ul>
          <div className="history__diff">
            {diff && (
              <>
                <p className="history__summary">
                  {interesting.length === 0
                    ? 'Same text as now.'
                    : `Since this version: ${[diff.changed && `${diff.changed} changed`, diff.added && `${diff.added} added`, diff.removed && `${diff.removed} removed`].filter(Boolean).join(', ')}. Removed text is struck through; added text is highlighted.`}
                </p>
                <ol className="ai-changes">
                  {interesting.map((c) => (
                    <li key={c.id} className="ai-change">
                      <p className="ai-diff">
                        {c.parts.map((part, i) =>
                          part.op === 'equal' ? <span key={i}>{part.text}</span>
                          : part.op === 'delete' ? <del key={i}>{part.text}</del>
                          : <ins key={i}>{part.text}</ins>,
                        )}
                      </p>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
        <div className="dialog__actions dialog__actions--split">
          <span className="library__actions">
            <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={async () => { setBusy(true); try { await onSaveNow(); } finally { setBusy(false); } }}>
              Save a version now
            </button>
            {version && interesting.length > 0 && (
              <button type="button" className="btn btn--sm" disabled={busy} onClick={async () => { setBusy(true); try { await onRestore(version.key); onClose(); } finally { setBusy(false); } }}>
                Restore this version
              </button>
            )}
          </span>
          <button className="btn btn--primary" value="close">Close</button>
        </div>
      </form>
    </dialog>
  );
}
