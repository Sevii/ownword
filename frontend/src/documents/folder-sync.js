// Keep a folder on disk in step with the library through the File System
// Access API (Chromium), so documents exist as Markdown files that Git,
// Obsidian, or a backup tool can see (improvement plan §3.2). Everything
// here takes a directory handle, and tests pass an in-memory one.

import { safeFilename } from './export.js';
import { markdownFromContent, withFrontMatter, parseFrontMatter, contentFromMarkdown, titleFromFilename } from './content.js';

/** @typedef {{ fileName: string, lastModified: number, updatedAt: number }} IndexEntry */
/** @typedef {Record<string, IndexEntry>} SyncIndex document id -> file */

export function isFolderSyncSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function pickFolder() {
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'open-writer-folder' });
}

/** @returns {Promise<'granted'|'prompt'|'denied'>} */
export async function permissionState(handle) {
  try { return await handle.queryPermission({ mode: 'readwrite' }); } catch { return 'denied'; }
}

/** Needs a user gesture. */
export async function requestPermission(handle) {
  try { return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch { return false; }
}

/** @param {string} title @param {string} id */
export function fileNameFor(title, id) {
  return `${safeFilename(title) || id.slice(0, 8)}.md`;
}

/**
 * Write one document as Markdown with front matter, renaming the file when
 * the title changed. Returns the new index entry.
 * @param {FileSystemDirectoryHandle} handle
 * @param {{ id: string, title: string, content: object, createdAt: number, updatedAt: number, goals?: object }} doc
 * @param {SyncIndex} index
 * @returns {Promise<IndexEntry>}
 */
export async function writeDocument(handle, doc, index) {
  const previous = index[doc.id];
  let fileName = fileNameFor(doc.title, doc.id);
  // Another document already owns that name: keep this one distinct.
  if (Object.entries(index).some(([id, e]) => id !== doc.id && e.fileName === fileName)) fileName = `${fileName.slice(0, -3)}-${doc.id.slice(0, 8)}.md`;
  const text = withFrontMatter(doc, markdownFromContent(doc.content));
  const fh = await handle.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(text);
  await writable.close();
  if (previous && previous.fileName !== fileName) {
    try { await handle.removeEntry(previous.fileName); } catch { /* already gone */ }
  }
  const file = await fh.getFile();
  return { fileName, lastModified: file.lastModified, updatedAt: doc.updatedAt };
}

/** Markdown files at the top level of the folder. */
export async function scanFolder(handle) {
  const files = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !/\.(md|markdown)$/iu.test(name) || name.startsWith('.')) continue;
    const file = await entry.getFile();
    files.push({ name, lastModified: file.lastModified, text: await file.text() });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Bring the folder and the library in step. Pure apart from the handle and
 * the store callbacks, so it is testable.
 *
 * - A file whose id (front matter) or name is unknown becomes a new document.
 * - A known file changed on disk since we last wrote it: if the document has
 *   not been edited here since, the disk version is loaded; otherwise it is
 *   reported as a conflict for the user to decide.
 * - A document with no file yet is written.
 * - A file we wrote that is now gone was deleted on purpose; forget it.
 *
 * @param {FileSystemDirectoryHandle} handle
 * @param {{
 *   index: SyncIndex,
 *   list: () => Promise<{ id: string, title: string, updatedAt: number }[]>,
 *   get: (id: string) => Promise<any>,
 *   put: (doc: any) => Promise<void>,
 *   create: (init: { title: string, content: object, goals?: object }) => Promise<{ id: string }>,
 * }} store
 * @returns {Promise<{ index: SyncIndex, added: number, loaded: number, written: number, conflicts: { id: string, title: string, fileName: string, text: string }[] }>}
 */
export async function reconcile(handle, { index, list, get, put, create }) {
  const next = { ...index };
  const files = await scanFolder(handle);
  const docs = await list();
  const byId = new Map(docs.map((d) => [d.id, d]));
  const idByFile = new Map(Object.entries(next).map(([id, e]) => [e.fileName, id]));
  const result = { index: next, added: 0, loaded: 0, written: 0, conflicts: [] };
  const seen = new Set();

  for (const file of files) {
    const { meta, body } = parseFrontMatter(file.text);
    const id = (meta.id && byId.has(meta.id) ? meta.id : null) ?? idByFile.get(file.name) ?? null;
    if (!id) {
      const created = await create({ title: meta.title ?? titleFromFilename(file.name), content: contentFromMarkdown(body), goals: meta.goals ?? {} });
      next[created.id] = { fileName: file.name, lastModified: file.lastModified, updatedAt: meta.updatedAt ?? 0 };
      seen.add(created.id);
      result.added++;
      continue;
    }
    seen.add(id);
    const entry = next[id];
    const doc = byId.get(id);
    const changedOnDisk = !entry || file.lastModified > entry.lastModified;
    if (!changedOnDisk) continue;
    const editedHere = entry ? doc.updatedAt > entry.updatedAt : true;
    if (editedHere && entry) {
      result.conflicts.push({ id, title: doc.title, fileName: file.name, text: file.text });
      continue;
    }
    if (!entry && doc.updatedAt >= (meta.updatedAt ?? file.lastModified)) {
      // First time this browser sees the folder and our copy is at least as new: write ours.
      next[id] = await writeDocument(handle, await get(id), next);
      result.written++;
      continue;
    }
    const full = await get(id);
    await put({ ...full, title: meta.title ?? full.title, content: contentFromMarkdown(body), goals: meta.goals ?? full.goals, updatedAt: Math.max(full.updatedAt, meta.updatedAt ?? 0, file.lastModified) });
    next[id] = { fileName: file.name, lastModified: file.lastModified, updatedAt: Math.max(full.updatedAt, meta.updatedAt ?? 0, file.lastModified) };
    result.loaded++;
  }

  for (const d of docs) {
    if (seen.has(d.id)) continue;
    if (next[d.id]) {
      delete next[d.id]; // its file was removed on disk
      continue;
    }
    next[d.id] = await writeDocument(handle, await get(d.id), next);
    result.written++;
  }
  return result;
}

/** An in-memory directory handle with the subset of the API used here, for tests. */
export function memoryFolder(initial = {}) {
  const files = new Map(Object.entries(initial).map(([name, text]) => [name, { text, lastModified: 1 }]));
  let clock = 1000;
  const fileHandle = (name) => ({
    kind: 'file',
    name,
    async getFile() {
      const f = files.get(name);
      return { name, lastModified: f.lastModified, text: async () => f.text };
    },
    async createWritable() {
      let buffer = '';
      return { async write(t) { buffer += t; }, async close() { files.set(name, { text: buffer, lastModified: ++clock }); } };
    },
  });
  return {
    kind: 'directory',
    name: 'memory',
    files,
    touch(name, text) { files.set(name, { text, lastModified: ++clock }); },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async getFileHandle(name, { create } = {}) {
      if (!files.has(name)) {
        if (!create) throw new DOMException('Not found', 'NotFoundError');
        files.set(name, { text: '', lastModified: ++clock });
      }
      return fileHandle(name);
    },
    async removeEntry(name) { files.delete(name); },
    async *entries() { for (const name of [...files.keys()]) yield [name, fileHandle(name)]; },
  };
}
