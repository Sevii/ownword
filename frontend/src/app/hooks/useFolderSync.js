// Folder autosave (plan §3.2): a chosen folder gets a Markdown file per
// document on every save, and changes made to those files elsewhere come
// back in. Off unless the user picks a folder; Chromium only.

import { useEffect, useRef, useState } from 'react';
import * as db from '../../documents/db.js';
import { isFolderSyncSupported, pickFolder, permissionState, requestPermission, reconcile, writeDocument } from '../../documents/folder-sync.js';
import { contentFromMarkdown, parseFrontMatter } from '../../documents/content.js';
import { sanitizeDocJson } from '../../editor/sanitize.js';
import { count } from '../telemetry.js';

const PREF = 'folderSync';

/**
 * @param {{
 *   prefsLoaded: boolean,
 *   docRef: React.MutableRefObject<any>,
 *   editorRef: React.MutableRefObject<import('@tiptap/core').Editor | null>,
 *   refreshDocs: () => Promise<void>,
 *   openDocument: (id: string) => Promise<void>,
 *   announce: (text: string) => void,
 * }} deps
 */
export function useFolderSync({ prefsLoaded, docRef, editorRef, refreshDocs, openDocument, announce }) {
  const supported = isFolderSyncSupported();
  // status: 'off' | 'ready' | 'needs-permission' | 'working' | 'error'
  const [state, setState] = useState({ status: 'off', name: '', message: '' });
  const [conflicts, setConflicts] = useState(/** @type {{ id: string, title: string, fileName: string, text: string }[]} */ ([]));
  const handleRef = useRef(/** @type {FileSystemDirectoryHandle | null} */ (null));
  const indexRef = useRef(/** @type {import('../../documents/folder-sync.js').SyncIndex} */ ({}));
  const writeChain = useRef(Promise.resolve());

  async function persist() {
    try {
      await db.setPref(PREF, { handle: handleRef.current, index: indexRef.current });
    } catch {
      // A handle that cannot be stored (some browsers, or a test double): the
      // connection lasts for this visit only.
    }
  }

  const store = {
    list: db.listDocuments,
    get: db.getDocument,
    put: (doc) => db.putDocument({ ...doc, content: sanitizeDocJson(doc.content) }),
    create: (init) => db.createDocument({ ...init, content: sanitizeDocJson(init.content) }),
  };

  async function sync(label) {
    const handle = handleRef.current;
    if (!handle) return;
    setState((s) => ({ ...s, status: 'working', message: 'Checking the folder…' }));
    try {
      const r = await reconcile(handle, { index: indexRef.current, ...store });
      indexRef.current = r.index;
      await persist();
      setConflicts(r.conflicts);
      await refreshDocs();
      const parts = [];
      if (r.added) parts.push(`${r.added} new from the folder`);
      if (r.loaded) parts.push(`${r.loaded} updated from the folder`);
      if (r.written) parts.push(`${r.written} written`);
      setState({ status: 'ready', name: handle.name, message: parts.length ? `${label}: ${parts.join(', ')}.` : `${label}: everything is in step.` });
      if (r.loaded && docRef.current && r.index[docRef.current.id]) {
        // The open document may have been replaced from disk.
        const fresh = await db.getDocument(docRef.current.id);
        if (fresh && fresh.saveId !== docRef.current.saveId) await openDocument(fresh.id);
      }
    } catch (err) {
      setState({ status: 'error', name: handle.name, message: `Could not read the folder: ${err?.message ?? err}` });
    }
  }

  // Restore the connection from the last visit.
  useEffect(() => {
    if (!prefsLoaded || !supported) return;
    (async () => {
      const stored = await db.getPref(PREF, null).catch(() => null);
      if (!stored?.handle) return;
      handleRef.current = stored.handle;
      indexRef.current = stored.index ?? {};
      const perm = await permissionState(stored.handle);
      if (perm === 'granted') await sync('Connected');
      else setState({ status: 'needs-permission', name: stored.handle.name, message: '' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded, supported]);

  async function connect() {
    let handle;
    try {
      handle = await pickFolder();
    } catch {
      return; // cancelled
    }
    handleRef.current = handle;
    indexRef.current = {};
    count('folder.connected');
    await sync('Connected');
  }

  async function reconnect() {
    const handle = handleRef.current;
    if (!handle) return;
    if (await requestPermission(handle)) await sync('Reconnected');
    else setState({ status: 'needs-permission', name: handle.name, message: 'Permission was not granted.' });
  }

  async function disconnect() {
    handleRef.current = null;
    indexRef.current = {};
    setConflicts([]);
    await db.setPref(PREF, null).catch(() => {});
    setState({ status: 'off', name: '', message: 'Disconnected. The files stay where they are.' });
  }

  /** Called after every successful save; writes run one at a time. */
  function onSaved(doc) {
    if (!handleRef.current || state.status === 'needs-permission') return;
    writeChain.current = writeChain.current
      .then(async () => {
        const handle = handleRef.current;
        if (!handle) return;
        indexRef.current = { ...indexRef.current, [doc.id]: await writeDocument(handle, doc, indexRef.current) };
        await persist();
      })
      .catch((err) => {
        setState((s) => ({ ...s, status: s.status === 'off' ? 'off' : 'error', message: `Could not write to the folder: ${err?.message ?? err}` }));
      });
  }

  /** A file changed on disk while the document was also edited here. */
  async function resolveConflict(id, loadFromDisk) {
    const c = conflicts.find((x) => x.id === id);
    if (!c) return;
    setConflicts((list) => list.filter((x) => x.id !== id));
    const handle = handleRef.current;
    const doc = await db.getDocument(id);
    if (!doc || !handle) return;
    if (loadFromDisk) {
      const { meta, body } = parseFrontMatter(c.text);
      const content = sanitizeDocJson(contentFromMarkdown(body));
      if (docRef.current?.id === id && editorRef.current) editorRef.current.commands.setContent(content);
      else await db.putDocument({ ...doc, title: meta.title ?? doc.title, content, updatedAt: Date.now() });
      const fh = await handle.getFileHandle(c.fileName);
      const file = await fh.getFile();
      indexRef.current = { ...indexRef.current, [id]: { fileName: c.fileName, lastModified: file.lastModified, updatedAt: Date.now() } };
      announce(`Loaded ${c.fileName} from the folder.`);
    } else {
      indexRef.current = { ...indexRef.current, [id]: await writeDocument(handle, doc, indexRef.current) };
      announce(`Kept this version; ${c.fileName} was rewritten.`);
    }
    await persist();
    await refreshDocs();
  }

  return { supported, state, conflicts, connect, reconnect, disconnect, onSaved, resolveConflict, sync: () => sync('Checked') };
}
