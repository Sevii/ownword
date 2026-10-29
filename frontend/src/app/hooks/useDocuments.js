// The document list, the open document, preferences, dismissals, recovery
// copies, and cross-tab notifications. Split out of App.jsx (plan §0.2).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from '../../documents/db.js';
import { docxToHtml, download } from '../../documents/export.js';
import { buildLibrary, readLibrary, mergeDocuments, mergePrefs, libraryFilename, documentFromFile } from '../../documents/library.js';
import { previewOf } from '../../documents/content.js';
import { sanitizeDocJson, sanitizePastedHtml } from '../../editor/sanitize.js';
import { takeHandoff, textToHtml, titleFrom } from '../../site/handoff.js';
import * as connections from '../../ai/connections.js';
import { count } from '../telemetry.js';
import { WELCOME_HTML, WELCOME_TITLE } from '../welcome.js';
import { useAutosave } from './useAutosave.js';

export const DEFAULT_PREFS = { dialect: 'en-US', dictionary: [], disabledRules: [], longSentenceWords: 30, paused: false };
const MAX_DISMISSALS = 500;

/**
 * @param {{
 *   editorRef: React.MutableRefObject<import('@tiptap/core').Editor | null>,
 *   pendingImport: React.MutableRefObject<{ html: string, parseOptions?: object } | null>,
 *   onOpen: () => void, called while a document is being opened, before it is set
 *   onHandoff: (handoff: { intent?: string }) => void,
 *   announce: (text: string) => void,
 *   onSaved?: (doc: db.StoredDocument) => void,
 * }} deps
 */
export function useDocuments({ editorRef, pendingImport, onOpen, onHandoff, announce, onSaved }) {
  const [docs, setDocs] = useState([]);
  const [doc, setDoc] = useState(/** @type {db.StoredDocument | null} */ (null));
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [dismissals, setDismissals] = useState([]);
  const [recovery, setRecovery] = useState([]);
  const [persisted, setPersisted] = useState(/** @type {boolean | null} */ (null));
  const [storageError, setStorageError] = useState('');
  // Bumped on every (re)load so the editor is rebuilt from the stored content,
  // even when the same document is reloaded.
  const [loadKey, setLoadKey] = useState(0);
  const [ai, setAi] = useState(connections.EMPTY);

  // Mutable mirrors for callbacks that outlive a render.
  const docRef = useRef(doc);
  const prefsRef = useRef(prefs);
  const dismissalsRef = useRef(dismissals);
  const channelRef = useRef(/** @type {BroadcastChannel | null} */ (null));
  docRef.current = doc;
  prefsRef.current = prefs;
  dismissalsRef.current = dismissals;

  const refreshDocs = useCallback(async () => setDocs(await db.listDocuments()), []);

  const autosave = useAutosave({ editorRef, docRef, setDoc, refreshDocs, channelRef, persisted, setPersisted, setRecovery, onSaved });
  const { save, flushSave, cancelPendingSave, saveChain, saveIdRef, lastRecoveryAt, saveStatus, setSaveStatus, scheduleSave } = autosave;

  useEffect(() => {
    (async () => {
      try {
        const stored = await db.getPref('settings', DEFAULT_PREFS);
        setPrefs({ ...DEFAULT_PREFS, ...stored });
        setDismissals(await db.getPref('dismissals', []));
        setAi(connections.normalize(await db.getPref('aiConnections', null)));
        let list = await db.listDocuments();
        const handoff = takeHandoff();
        if (handoff) {
          // Text pasted on a landing page becomes its own document.
          const created = await importText(handoff.text, titleFrom(handoff.text));
          onHandoff(handoff);
          setPersisted(navigator.storage?.persisted ? await navigator.storage.persisted() : false);
          if (created) return;
        }
        if (!list.length) {
          // First visit: a short guided document with mistakes to try.
          pendingImport.current = { html: WELCOME_HTML };
          await db.createDocument({ title: WELCOME_TITLE });
          list = await db.listDocuments();
          count('document.created');
        }
        setDocs(list);
        const lastId = await db.getPref('lastDocumentId', null);
        await openDocument(list.find((d) => d.id === lastId)?.id ?? list[0].id);
        setPersisted(navigator.storage?.persisted ? await navigator.storage.persisted() : false);
      } catch (err) {
        setStorageError(`Local storage is unavailable (${err?.message ?? err}). You can still write, but nothing will be saved: export your work.`);
        setDoc({ id: 'unsaved', title: 'Untitled', content: { type: 'doc', content: [{ type: 'paragraph' }] }, saveId: '', createdAt: Date.now(), updatedAt: Date.now(), goals: {} });
      } finally {
        setPrefsLoaded(true);
        count('app.loaded');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openDocument(id) {
    await flushSave();
    const d = await db.getDocument(id);
    if (!d) return;
    saveIdRef.current = d.saveId;
    lastRecoveryAt.current = Date.now();
    onOpen();
    setSaveStatus('saved');
    setDoc(d);
    setLoadKey((k) => k + 1);
    setRecovery(await db.listRecovery(id));
    db.setPref('lastDocumentId', id).catch(() => {});
  }

  // Another tab saved the open document.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel('online-writer');
    channelRef.current = ch;
    ch.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type !== 'saved' && msg?.type !== 'deleted') return;
      refreshDocs();
      if (msg.id !== docRef.current?.id) return;
      if (msg.type === 'deleted') setSaveStatus('deleted');
      else if (msg.saveId !== saveIdRef.current) setSaveStatus((s) => (s === 'saved' ? 'conflict-clean' : 'conflict'));
    };
    return () => {
      ch.close();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshDocs]);

  // A clean document is simply reloaded when another tab changes it.
  useEffect(() => {
    if (saveStatus === 'conflict-clean' && doc) openDocument(doc.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus]);

  function updateDoc(patch) {
    setDoc((d) => (d ? { ...d, ...patch } : d));
    docRef.current = { ...docRef.current, ...patch };
    scheduleSave();
  }

  /** Replace the preferences in state, in the ref callbacks read, and on disk. */
  function savePrefs(next) {
    prefsRef.current = next;
    setPrefs(next);
    return db.setPref('settings', next).catch(() => {});
  }

  /** Persist before updating the UI, so a dismissal survives an immediate reload. */
  async function addDismissal(record) {
    const next = [...dismissalsRef.current, record].slice(-MAX_DISMISSALS);
    dismissalsRef.current = next;
    setDismissals(next);
    await db.setPref('dismissals', next).catch(() => {});
  }

  /** Pin, unpin, or tag a document from the list. The open document goes through its save. */
  async function setDocMeta(id, patch) {
    if (id === docRef.current?.id) {
      updateDoc(patch);
      return;
    }
    await db.patchDocument(id, patch).catch(() => {});
    await refreshDocs();
  }

  function changeAi(next) {
    setAi(next);
    db.setPref('aiConnections', connections.forStorage(next)).catch(() => announce('Could not save the AI connection in this browser.'));
  }

  /** Open a .docx, .md, or .txt file as a new document. */
  async function importFile(file) {
    try {
      if (/\.docx$/iu.test(file.name)) {
        const { html } = await docxToHtml(await file.arrayBuffer());
        pendingImport.current = { html: sanitizePastedHtml(html) };
        const created = await db.createDocument({ title: file.name.replace(/\.docx$/iu, '') });
        count('import.docx');
        await refreshDocs();
        await openDocument(created.id);
        return;
      }
      const d = documentFromFile(file.name, await file.text());
      if (d.content) {
        const created = await db.createDocument({ title: d.title, content: d.content, goals: d.goals, preview: previewOf(d.content) });
        count('import.md');
        await refreshDocs();
        await openDocument(created.id);
      } else {
        await importText(d.text ?? '', d.title, { lines: true });
      }
    } catch (err) {
      announce(`Could not import that file: ${err?.message ?? err}`);
    }
  }

  /** Every document, with preferences and dismissals, as one zip. Keys are never included. */
  async function exportLibrary() {
    await flushSave();
    const list = await db.listDocuments();
    const documents = (await Promise.all(list.map((d) => db.getDocument(d.id)))).filter(Boolean);
    const bytes = buildLibrary({ documents, prefs: prefsRef.current, dismissals: dismissalsRef.current });
    download(new Blob([bytes], { type: 'application/zip' }), libraryFilename());
    count('export.library');
    return documents.length;
  }

  /**
   * Merge a library zip, a zip of Markdown files, or one Markdown or text
   * file. Returns a sentence for the UI.
   */
  async function importLibrary(file) {
    const read = readLibrary(new Uint8Array(await file.arrayBuffer()), file.name);
    // Plain-text files need the editor to make content, so they open directly.
    const plain = read.documents.filter((d) => !d.content);
    const counts = await mergeDocuments(read.documents, { list: db.listDocuments, put: (doc) => db.putDocument({ ...doc, preview: previewOf(doc.content) }) });
    for (const d of plain) await importText(d.text ?? '', d.title, { lines: true });
    if (read.prefs) await savePrefs(mergePrefs(prefsRef.current, read.prefs));
    if (read.dismissals?.length) {
      const seen = new Set(dismissalsRef.current.map((x) => JSON.stringify(x)));
      const merged = [...dismissalsRef.current, ...read.dismissals.filter((x) => !seen.has(JSON.stringify(x)))].slice(-MAX_DISMISSALS);
      dismissalsRef.current = merged;
      setDismissals(merged);
      await db.setPref('dismissals', merged).catch(() => {});
    }
    count('import.library');
    await refreshDocs();
    if (!docRef.current || docRef.current.id === 'unsaved') {
      const list = await db.listDocuments();
      if (list.length) await openDocument(list[0].id);
    }
    const parts = [];
    if (counts.added + plain.length) parts.push(`${counts.added + plain.length} added`);
    if (counts.updated) parts.push(`${counts.updated} updated`);
    if (counts.skipped) parts.push(`${counts.skipped} already up to date`);
    return `Imported: ${parts.join(', ') || 'nothing new'}.`;
  }

  /** Make a new document from plain text and open it. */
  async function importText(text, title, { lines = false } = {}) {
    // Lines from a text field keep their spacing (indents, aligned columns).
    pendingImport.current = { html: textToHtml(text, { lines }), parseOptions: lines ? { preserveWhitespace: 'full' } : undefined };
    const created = await db.createDocument({ title });
    count('document.created');
    await refreshDocs();
    await openDocument(created.id);
    return created;
  }

  async function newDocument() {
    const created = await db.createDocument();
    count('document.created');
    await refreshDocs();
    await openDocument(created.id);
  }

  async function removeDocument(id) {
    // A pending save of this document would write it back after the delete.
    if (id === docRef.current?.id) {
      cancelPendingSave();
      await saveChain.current;
    }
    await db.deleteDocument(id);
    channelRef.current?.postMessage({ type: 'deleted', id });
    count('document.deleted');
    const list = await db.listDocuments();
    if (!list.length) return newDocument();
    setDocs(list);
    if (id === docRef.current?.id) await openDocument(list[0].id);
  }

  async function restore(key) {
    const r = recovery.find((x) => x.key === key);
    const editor = editorRef.current;
    if (!r || !editor) return;
    editor.commands.setContent(sanitizeDocJson(r.content));
    count('document.recovered');
  }

  async function resolveConflict(keepMine) {
    if (keepMine) await save(true);
    else if (docRef.current) {
      cancelPendingSave();
      await openDocument(docRef.current.id);
    }
  }

  /** The open document was deleted in another tab: keep it here, or let it go. */
  async function resolveDeleted(keep) {
    if (keep) {
      await save(true);
      return;
    }
    cancelPendingSave();
    const list = await db.listDocuments();
    setDocs(list);
    if (list.length) await openDocument(list[0].id);
    else await newDocument();
  }

  return {
    docs, doc, docRef, prefs, prefsRef, prefsLoaded, dismissals, dismissalsRef, recovery, persisted, storageError, loadKey, ai,
    saveStatus, save, scheduleSave, refreshDocs, openDocument, updateDoc, setDocMeta, savePrefs, addDismissal, changeAi,
    importFile, importText, exportLibrary, importLibrary, flushSave, newDocument, removeDocument, restore, resolveConflict, resolveDeleted,
  };
}
