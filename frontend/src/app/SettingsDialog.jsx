import { useEffect, useRef, useState } from 'react';
import { DIALECTS } from './labels.js';
import { ConnectionsSection } from './ConnectionsSection.jsx';

/**
 * @param {{ open: boolean, onClose: () => void, prefs: any, persisted: boolean | null,
 *   onChange: (patch: object) => void, onRemoveWord: (w: string) => void,
 *   onEnableRule: (id: string) => void, ai: import('../ai/connections.js').Connections,
 *   onAiChange: (next: import('../ai/connections.js').Connections) => void, onAiConnected: () => void }} props
 */
export function SettingsDialog({ open, onClose, prefs, persisted, onChange, onRemoveWord, onEnableRule, ai, onAiChange, onAiConnected, onExportLibrary, onImportLibrary, folder, disabledProviders = [] }) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="settings-title">
      <form
        method="dialog"
        className="dialog__body"
        // Close only from the Done button. Safari submits the form when Enter is pressed
        // in a field (such as an API key) even if the key press was handled.
        onSubmit={(e) => {
          if (e.nativeEvent.submitter?.value !== 'close') e.preventDefault();
        }}
      >
        <h2 id="settings-title">Settings</h2>

        <label className="field">
          <span>English variety</span>
          <select value={prefs.dialect} onChange={(e) => onChange({ dialect: e.target.value })}>
            {DIALECTS.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Mark sentences longer than</span>
          <span className="field__inline">
            <SentenceLengthInput value={prefs.longSentenceWords} onChange={(n) => onChange({ longSentenceWords: n })} />{' '}
            words
          </span>
        </label>

        <label className="field field--check">
          <input type="checkbox" checked={prefs.paused} onChange={(e) => onChange({ paused: e.target.checked })} />
          <span>Pause checking</span>
        </label>

        <h3>Personal dictionary</h3>
        {prefs.dictionary.length ? (
          <ul className="chips">
            {prefs.dictionary.map((w) => (
              <li key={w}>
                {w}{' '}
                <button type="button" className="btn btn--sm btn--ghost" aria-label={`Remove ${w}`} onClick={() => onRemoveWord(w)}>×</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Words you add from a spelling suggestion appear here.</p>
        )}

        <h3>Checks you turned off</h3>
        {prefs.disabledRules.length ? (
          <ul className="chips">
            {prefs.disabledRules.map((id) => (
              <li key={id}>
                {id}{' '}
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => onEnableRule(id)}>Turn on</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None.</p>
        )}

        <ConnectionsSection value={ai} onChange={onAiChange} onConnected={onAiConnected} disabledProviders={disabledProviders} />

        <LibrarySection onExport={onExportLibrary} onImport={onImportLibrary} />
        {folder && <FolderSection folder={folder} />}

        <h3>Privacy and storage</h3>
        <p className="muted">
          Proofreading runs in this browser. Your writing is not sent anywhere unless you start an AI action, which
          sends the selected text to the AI provider you connected.
          Drafts are stored only on this device. <a href={`${import.meta.env.BASE_URL}privacy/`} target="_blank" rel="noopener">How your data is handled</a>
        </p>
        {persisted === false && (
          <p className="callout">
            This browser may clear stored drafts, for example Safari after 7 days without a visit. Export work you
            want to keep.
          </p>
        )}

        <div className="dialog__actions dialog__actions--split">
          <button className="btn btn--primary" value="close">Done</button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Export every document as a zip, or import one (plan §3.1).
 * @param {{ onExport: () => Promise<number>, onImport: (file: File) => Promise<string> }} props
 */
function LibrarySection({ onExport, onImport }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setStatus('Working…');
    try {
      setStatus(await fn());
    } catch (err) {
      setStatus(`That did not work: ${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="library-title">
      <h3 id="library-title">Your documents</h3>
      <p className="muted">
        Keep a copy of everything outside this browser: a zip with one Markdown file per document plus your preferences.
        Importing merges by document; newer versions win and nothing is deleted. API keys are never exported.
      </p>
      <div className="library__actions">
        <button type="button" className="btn btn--sm btn--secondary" disabled={busy} onClick={() => run(async () => { const n = await onExport(); return `Exported ${n} document${n === 1 ? '' : 's'}.`; })}>
          Export all documents (.zip)
        </button>
        <label className={`btn btn--sm btn--secondary${busy ? ' btn--disabled' : ''}`}>
          Import a library or file
          <input
            type="file"
            accept=".zip,.md,.markdown,.txt,application/zip,text/markdown,text/plain"
            className="visually-hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) run(() => onImport(f));
            }}
          />
        </label>
      </div>
      {status && <p className="muted library__status" role="status">{status}</p>}
    </section>
  );
}

/**
 * A folder on this computer that mirrors the library as Markdown (plan §3.2).
 * @param {{ folder: ReturnType<typeof import('./hooks/useFolderSync.js').useFolderSync> }} props
 */
function FolderSection({ folder }) {
  const { supported, state } = folder;
  const on = state.status !== 'off';
  return (
    <section aria-labelledby="folder-title">
      <h3 id="folder-title">Folder on this computer</h3>
      {!supported ? (
        <p className="muted">
          Saving straight into a folder needs the File System Access API, which this browser does not offer (Chrome and Edge do).
          Use “Export all documents” above for a copy you can keep.
        </p>
      ) : (
        <>
          <p className="muted">
            Choose a folder and every document is kept there as a Markdown file as you write, with changes made to the
            files by other apps picked up when you open the editor. Good for Git, Obsidian, and backups.
          </p>
          {on && (
            <p className="folder__status">
              <strong>{state.name}</strong>
              {state.status === 'needs-permission' ? ' needs permission again. ' : state.status === 'working' ? ' is being checked. ' : state.status === 'error' ? ' had a problem. ' : ' is connected. '}
              {state.message && <span className="muted">{state.message}</span>}
            </p>
          )}
          {!on && state.message && <p className="muted folder__status" role="status">{state.message}</p>}
          <div className="library__actions">
            {!on && <button type="button" className="btn btn--sm btn--secondary" onClick={folder.connect}>Choose folder</button>}
            {state.status === 'needs-permission' && <button type="button" className="btn btn--sm" onClick={folder.reconnect}>Reconnect</button>}
            {on && state.status !== 'needs-permission' && (
              <button type="button" className="btn btn--sm btn--secondary" disabled={state.status === 'working'} onClick={folder.sync}>Check now</button>
            )}
            {on && <button type="button" className="btn btn--sm btn--ghost" onClick={folder.disconnect}>Disconnect</button>}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Typing keeps whatever is entered; only whole numbers from 10 to 100 are
 * applied, and leaving the field puts back the applied value.
 * @param {{ value: number, onChange: (n: number) => void }} props
 */
function SentenceLengthInput({ value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const valid = (n) => Number.isInteger(n) && n >= 10 && n <= 100;
  return (
    <input
      type="number"
      min={10}
      max={100}
      value={draft}
      aria-invalid={!valid(Number(draft))}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && valid(n) && n !== value) onChange(n);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
