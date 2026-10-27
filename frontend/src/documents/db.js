// IndexedDB storage for drafts, recovery copies, and preferences. Everything
// stays on this device (plan §6.7).

const DB_NAME = 'open-writer';
const DB_VERSION = 1;
const RECOVERY_KEEP = 10;

/** @type {Promise<IDBDatabase> | null} */
let opening = null;

export function openDb() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('documents', { keyPath: 'id' });
      const recovery = db.createObjectStore('recovery', { keyPath: 'key', autoIncrement: true });
      recovery.createIndex('documentId', 'documentId');
      db.createObjectStore('prefs', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

/**
 * @template T
 * @param {string[]} stores
 * @param {IDBTransactionMode} mode
 * @param {(tx: IDBTransaction) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    Promise.resolve(fn(tx)).then(
      (r) => (result = r),
      (err) => {
        reject(err);
        try {
          tx.abort();
        } catch {
          // already finished
        }
      },
    );
  });
}

/** @template T @param {IDBRequest<T>} req @returns {Promise<T>} */
const done = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

/**
 * @typedef {{ id: string, title: string, content: object, saveId: string, createdAt: number,
 *   updatedAt: number, goals?: { audience?: string, formality?: string, intent?: string } }} StoredDocument
 */

export class SaveConflictError extends Error {
  constructor(current) {
    super('This document was changed in another tab.');
    this.current = current;
  }
}

/** The document was deleted, here or in another tab, after it was opened. */
export class DocumentMissingError extends Error {
  constructor() {
    super('This document was deleted.');
  }
}

/** @returns {Promise<Omit<StoredDocument, 'content'>[]>} */
export async function listDocuments() {
  const docs = await run(['documents'], 'readonly', (tx) => done(tx.objectStore('documents').getAll()));
  return docs
    .map(({ content: _c, ...rest }) => rest)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** @param {string} id @returns {Promise<StoredDocument | undefined>} */
export function getDocument(id) {
  return run(['documents'], 'readonly', (tx) => done(tx.objectStore('documents').get(id)));
}

/** @param {Partial<StoredDocument>} [init] @returns {Promise<StoredDocument>} */
export async function createDocument(init = {}) {
  const now = Date.now();
  const doc = {
    id: crypto.randomUUID(),
    title: init.title ?? 'Untitled',
    content: init.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    saveId: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    goals: init.goals ?? {},
  };
  await run(['documents'], 'readwrite', (tx) => done(tx.objectStore('documents').put(doc)));
  return doc;
}

/**
 * Save if nobody else saved since `expectedSaveId`; otherwise throw
 * SaveConflictError so another tab's work is never silently overwritten.
 * A deleted document is not re-created: that throws DocumentMissingError.
 * Pass force to overwrite (or re-create) deliberately.
 * @param {StoredDocument} doc
 * @param {string} expectedSaveId
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<StoredDocument>}
 */
export function saveDocument(doc, expectedSaveId, opts = {}) {
  return run(['documents'], 'readwrite', async (tx) => {
    const store = tx.objectStore('documents');
    const existing = await done(store.get(doc.id));
    if (!opts.force) {
      if (!existing) throw new DocumentMissingError();
      if (existing.saveId !== expectedSaveId) throw new SaveConflictError(existing);
    }
    const saved = { ...doc, saveId: crypto.randomUUID(), updatedAt: Date.now() };
    await done(store.put(saved));
    return saved;
  });
}

/** @param {string} id */
export function deleteDocument(id) {
  return run(['documents', 'recovery'], 'readwrite', async (tx) => {
    tx.objectStore('documents').delete(id);
    const keys = await done(tx.objectStore('recovery').index('documentId').getAllKeys(id));
    for (const k of keys) tx.objectStore('recovery').delete(k);
  });
}

/** @param {string} documentId @param {string} title @param {object} content */
export function addRecovery(documentId, title, content) {
  return run(['recovery'], 'readwrite', async (tx) => {
    const store = tx.objectStore('recovery');
    await done(store.add({ documentId, title, content, savedAt: Date.now() }));
    const keys = await done(store.index('documentId').getAllKeys(documentId));
    for (const k of keys.slice(0, Math.max(0, keys.length - RECOVERY_KEEP))) store.delete(k);
  });
}

/** @param {string} documentId */
export async function listRecovery(documentId) {
  const all = await run(['recovery'], 'readonly', (tx) => done(tx.objectStore('recovery').index('documentId').getAll(documentId)));
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/** @template T @param {string} key @param {T} fallback @returns {Promise<T>} */
export async function getPref(key, fallback) {
  const row = await run(['prefs'], 'readonly', (tx) => done(tx.objectStore('prefs').get(key)));
  return row ? row.value : fallback;
}

/** @param {string} key @param {unknown} value */
export function setPref(key, value) {
  return run(['prefs'], 'readwrite', (tx) => done(tx.objectStore('prefs').put({ key, value })));
}

/**
 * Ask the browser not to evict our storage (Safari otherwise may delete it
 * after 7 days without a visit). Returns whether storage is persistent.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
