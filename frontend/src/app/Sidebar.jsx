import { useMemo, useState } from 'react';
import { IconPlus, IconUpload } from './icons.jsx';

function relativeTime(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Pinned first, then most recently changed. */
export function sortDocuments(docs) {
  return [...docs].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
}

/** Title, first words, and tags, case-insensitively; a chosen tag must be present. */
export function filterDocuments(docs, query, tag) {
  const q = query.trim().toLowerCase();
  return docs.filter((d) => {
    if (tag && !(d.tags ?? []).includes(tag)) return false;
    if (!q) return true;
    return `${d.title ?? ''} ${d.preview ?? ''} ${(d.tags ?? []).join(' ')}`.toLowerCase().includes(q);
  });
}

export function normalizeTag(raw) {
  return raw.trim().replace(/^#/u, '').replace(/\s+/gu, '-').toLowerCase().slice(0, 32);
}

/**
 * @param {{ open: boolean, docs: { id: string, title: string, updatedAt: number, pinned?: boolean, tags?: string[], preview?: string }[], currentId: string | null,
 *   onOpen: (id: string) => void, onNew: () => void, onDelete: (id: string) => void,
 *   onPin: (id: string, pinned: boolean) => void, onTags: (id: string, tags: string[]) => void,
 *   onImport: (file: File) => void, recovery: { key: number, savedAt: number }[],
 *   onRestore: (key: number) => void }} props
 */
export function Sidebar({ open, docs, currentId, onOpen, onNew, onDelete, onPin, onTags, onImport, recovery, onRestore }) {
  const [confirming, setConfirming] = useState(/** @type {string | null} */ (null));
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [newTag, setNewTag] = useState('');
  const allTags = useMemo(() => [...new Set(docs.flatMap((d) => d.tags ?? []))].sort((a, b) => a.localeCompare(b)), [docs]);
  const shown = useMemo(() => sortDocuments(filterDocuments(docs, query, tag)), [docs, query, tag]);
  const current = docs.find((d) => d.id === currentId);

  function addTag() {
    const t = normalizeTag(newTag);
    if (!t || !current) return;
    if (!(current.tags ?? []).includes(t)) onTags(current.id, [...(current.tags ?? []), t]);
    setNewTag('');
  }

  return (
    <nav className="drawer" aria-label="Documents" hidden={!open}>
      <div className="drawer__head">
        <p className="eyebrow">Documents</p>
        <button type="button" className="btn btn--sm" onClick={onNew}>
          <IconPlus /> New
        </button>
      </div>
      {docs.length > 1 && (
        <input className="drawer__search" type="search" aria-label="Search documents" placeholder="Search documents" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {allTags.length > 0 && (
        <div className="tagrow" role="group" aria-label="Filter by tag">
          {allTags.map((t) => (
            <button key={t} type="button" className={`tag${tag === t ? ' tag--on' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
      <ul className="doclist">
        {shown.map((d) => (
          <li key={d.id} className={`doclist__item${d.id === currentId ? ' doclist__item--current' : ''}`}>
            <button type="button" className="doclist__open" aria-current={d.id === currentId ? 'page' : undefined} onClick={() => onOpen(d.id)}>
              <span className="doclist__title">{d.pinned ? '📌 ' : ''}{d.title || 'Untitled'}</span>
              <span className="doclist__date">
                {relativeTime(d.updatedAt)}
                {d.tags?.length ? ` · ${d.tags.map((t) => `#${t}`).join(' ')}` : ''}
              </span>
            </button>
            {confirming === d.id ? (
              <span className="doclist__confirm">
                <button type="button" className="btn btn--sm btn--danger" onClick={() => (setConfirming(null), onDelete(d.id))}>Delete</button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirming(null)}>Keep</button>
              </span>
            ) : (
              <span className="doclist__tools">
                <button type="button" className="btn btn--sm btn--ghost doclist__pin" aria-pressed={Boolean(d.pinned)} aria-label={`${d.pinned ? 'Unpin' : 'Pin'} ${d.title || 'Untitled'}`} onClick={() => onPin(d.id, !d.pinned)}>
                  {d.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button type="button" className="btn btn--sm btn--ghost doclist__delete" aria-label={`Delete ${d.title || 'Untitled'}`} onClick={() => setConfirming(d.id)}>
                  Delete
                </button>
              </span>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="muted doclist__empty">No documents match.</li>}
      </ul>
      {current && (
        <div className="tags" aria-label="Tags for this document">
          <p className="eyebrow">Tags</p>
          <div className="tagrow">
            {(current.tags ?? []).map((t) => (
              <span key={t} className="tag tag--on">
                #{t}{' '}
                <button type="button" className="tag__remove" aria-label={`Remove tag ${t}`} onClick={() => onTags(current.id, (current.tags ?? []).filter((x) => x !== t))}>×</button>
              </span>
            ))}
            <input
              className="tags__input"
              type="text"
              aria-label="Add a tag"
              placeholder="Add a tag"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
          </div>
        </div>
      )}
      <div className="drawer__foot">
        <label className="btn btn--secondary btn--sm">
          <IconUpload /> Import file
          <input
            type="file"
            accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
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
