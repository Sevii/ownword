// Debounced saves that run one at a time, recovery copies, and the one-time
// storage persistence request. Split out of App.jsx (improvement plan §0.2).

import { useEffect, useRef, useState } from 'react';
import * as db from '../../documents/db.js';
import { count } from '../telemetry.js';

export const SAVE_DEBOUNCE_MS = 600;
export const RECOVERY_EVERY_MS = 5 * 60_000;

/**
 * @param {{
 *   editorRef: React.MutableRefObject<import('@tiptap/core').Editor | null>,
 *   docRef: React.MutableRefObject<db.StoredDocument | null>,
 *   setDoc: (fn: (d: db.StoredDocument | null) => db.StoredDocument | null) => void,
 *   refreshDocs: () => Promise<void>,
 *   channelRef: React.MutableRefObject<BroadcastChannel | null>,
 *   persisted: boolean | null,
 *   setPersisted: (v: boolean) => void,
 *   setRecovery: (r: any[]) => void,
 * }} deps
 */
export function useAutosave({ editorRef, docRef, setDoc, refreshDocs, channelRef, persisted, setPersisted, setRecovery }) {
  const [saveStatus, setSaveStatus] = useState('saved');
  const saveIdRef = useRef('');
  const saveTimer = useRef(0);
  const lastRecoveryAt = useRef(0);
  const saveChain = useRef(Promise.resolve());
  const persistAsked = useRef(false);
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;

  /** Saves run one at a time, so each one expects the saveId the previous one wrote. */
  function save(force = false) {
    const next = saveChain.current.then(() => saveNow(force));
    saveChain.current = next;
    return next;
  }

  async function saveNow(force) {
    const ed = editorRef.current;
    const d = docRef.current;
    if (!ed || !d || d.id === 'unsaved') return;
    clearTimeout(saveTimer.current);
    saveTimer.current = 0;
    setSaveStatus('saving');
    try {
      const content = ed.getJSON();
      const saved = await db.saveDocument({ ...d, content }, saveIdRef.current, { force });
      // Keep edits made while the write ran (a title keystroke, say); only take the new saveId.
      if (docRef.current?.id === saved.id) {
        saveIdRef.current = saved.saveId;
        docRef.current = { ...docRef.current, saveId: saved.saveId, updatedAt: saved.updatedAt };
        setDoc((cur) => (cur?.id === saved.id ? { ...cur, saveId: saved.saveId, updatedAt: saved.updatedAt } : cur));
      }
      setSaveStatus(saveTimer.current ? 'unsaved' : 'saved');
      channelRef.current?.postMessage({ type: 'saved', id: saved.id, saveId: saved.saveId });
      refreshDocs();
      if (Date.now() - lastRecoveryAt.current > RECOVERY_EVERY_MS) {
        lastRecoveryAt.current = Date.now();
        await db.addRecovery(saved.id, saved.title, content);
        setRecovery(await db.listRecovery(saved.id));
      }
      // Ask once per session: browsers that refuse keep refusing, and some prompt.
      // Not awaited: Firefox shows a permission prompt, and saving must not wait
      // for the user to answer it.
      if (!persistAsked.current && persistedRef.current !== true) {
        persistAsked.current = true;
        db.requestPersistence().then(
          (granted) => {
            setPersisted(granted);
            count(granted ? 'storage.persist_granted' : 'storage.persist_denied');
          },
          () => {},
        );
      }
    } catch (err) {
      if (err instanceof db.SaveConflictError) setSaveStatus('conflict');
      else if (err instanceof db.DocumentMissingError) setSaveStatus('deleted');
      else {
        setSaveStatus('error');
        count('storage.save_failed');
      }
    }
  }

  function scheduleSave() {
    setSaveStatus((s) => (s === 'conflict' || s === 'deleted' ? s : 'unsaved'));
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(), SAVE_DEBOUNCE_MS);
  }

  async function flushSave() {
    if (saveTimer.current) await save();
    else await saveChain.current;
  }

  /** Drop a pending save without writing it. */
  function cancelPendingSave() {
    clearTimeout(saveTimer.current);
    saveTimer.current = 0;
  }

  useEffect(() => {
    const onUnload = (e) => {
      if (saveTimer.current) {
        save();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  });

  return { saveStatus, setSaveStatus, save, scheduleSave, flushSave, cancelPendingSave, saveChain, saveIdRef, lastRecoveryAt };
}
