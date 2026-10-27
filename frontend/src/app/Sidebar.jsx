import { useState } from 'react';
import { IconPlus, IconUpload } from './icons.jsx';

function relativeTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * @param {{ open: boolean, docs: { id: string, title: string, updatedAt: number }[], currentId: string | null,
 *   onOpen: (id: string) => void, onNew: () => void, onDelete: (id: string) => void,
 *   onImport: (file: File) => void, recovery: { key: number, savedAt: number }[],
 *   onRestore: (key: number) => void }} props
 */
export function Sidebar({ open, docs, currentId, onOpen, onNew, onDelete, onImport, recovery, onRestore }) {
  const [confirming, setConfirming] = useState(/** @type {string | null} */ (null));
  return (
    <nav className="drawer" aria-label="Documents" hidden={!open}>
      <div className="drawer__head">
        <p className="eyebrow">Documents</p>
        <button type="button" className="btn btn--sm" onClick={onNew}>
          <IconPlus /> New
        </button>
      </div>
      <ul className="doclist">
        {docs.map((d) => (
          <li key={d.id} className={`doclist__item${d.id === currentId ? ' doclist__item--current' : ''}`}>
            <button type="button" className="doclist__open" aria-current={d.id === currentId ? 'page' : undefined} onClick={() => onOpen(d.id)}>
              <span className="doclist__title">{d.title || 'Untitled'}</span>
              <span className="doclist__date">{relativeTime(d.updatedAt)}</span>
            </button>
            {confirming === d.id ? (
              <span className="doclist__confirm">
                <button type="button" className="btn btn--sm btn--danger" onClick={() => (setConfirming(null), onDelete(d.id))}>Delete</button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirming(null)}>Keep</button>
              </span>
            ) : (
              <button type="button" className="btn btn--sm btn--ghost doclist__delete" aria-label={`Delete ${d.title || 'Untitled'}`} onClick={() => setConfirming(d.id)}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="drawer__foot">
        <label className="btn btn--secondary btn--sm">
          <IconUpload /> Import .docx
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </label>
        {recovery.length > 0 && (
          <details className="recovery">
            <summary>Earlier versions of this document</summary>
            <ul>
              {recovery.map((r) => (
                <li key={r.key}>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => onRestore(r.key)}>
                    Restore {new Date(r.savedAt).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </nav>
  );
}
