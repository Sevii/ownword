// Whole-library export and import as a zip: one Markdown file per document
// for people and other tools, plus library.json with the exact editor
// content, preferences, and dismissals (improvement plan §3.1). Keys are
// never included.

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { safeFilename } from './export.js';
import { contentFromMarkdown, markdownFromContent, parseFrontMatter, titleFromFilename, withFrontMatter } from './content.js';
import { sanitizeDocJson } from '../editor/sanitize.js';

export const LIBRARY_VERSION = 1;

/** @typedef {{ id: string, title: string, content: object, createdAt: number, updatedAt: number, goals?: object }} LibraryDocument */

/**
 * @param {{ documents: LibraryDocument[], prefs?: object, dismissals?: unknown[] }} library
 * @returns {Uint8Array} zip bytes
 */
export function buildLibrary({ documents, prefs = {}, dismissals = [] }) {
  const files = {};
  const used = new Set();
  const index = [];
  for (const d of documents) {
    let name = safeFilename(d.title);
    if (used.has(name)) name = `${name}-${d.id.slice(0, 8)}`;
    used.add(name);
    const file = `documents/${name}.md`;
    files[file] = strToU8(withFrontMatter(d, markdownFromContent(d.content)));
    index.push({ id: d.id, title: d.title, file, createdAt: d.createdAt, updatedAt: d.updatedAt, goals: d.goals ?? {}, content: d.content });
  }
  const { dialect, dictionary, disabledRules, longSentenceWords } = prefs;
  const manifest = {
    version: LIBRARY_VERSION,
    app: 'open-writer',
    exportedAt: new Date().toISOString(),
    prefs: { dialect, dictionary, disabledRules, longSentenceWords },
    dismissals,
    documents: index,
  };
  files['library.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['README.txt'] = strToU8(
    'Exported from Open Writer.\n\nEach file in documents/ is one document as Markdown with its identity in the front matter. library.json holds the exact editor content, your preferences, and dismissed suggestions, and is what Open Writer imports. API keys are never exported.\n',
  );
  return zipSync(files, { level: 6 });
}

/**
 * Read a zip from this app, or any zip or single file of Markdown or text.
 * @param {Uint8Array} bytes
 * @param {string} [filename]
 * @returns {{ documents: Partial<LibraryDocument>[], prefs: object | null, dismissals: unknown[] | null }}
 */
export function readLibrary(bytes, filename = '') {
  if (/\.(md|markdown|txt)$/iu.test(filename)) return { documents: [documentFromFile(filename, strFromU8(bytes))], prefs: null, dismissals: null };
  const entries = unzipSync(bytes);
  const manifestEntry = Object.keys(entries).find((n) => n === 'library.json' || n.endsWith('/library.json'));
  if (manifestEntry) {
    const manifest = JSON.parse(strFromU8(entries[manifestEntry]));
    if (manifest?.app !== 'open-writer' || !Array.isArray(manifest.documents)) throw new Error('library.json is not from Open Writer.');
    const documents = manifest.documents
      .filter((d) => d && typeof d.id === 'string' && d.content && typeof d.content === 'object')
      .map((d) => ({
        id: d.id,
        title: typeof d.title === 'string' ? d.title : 'Untitled',
        content: sanitizeDocJson(d.content),
        createdAt: Number(d.createdAt) || Date.now(),
        updatedAt: Number(d.updatedAt) || Date.now(),
        goals: d.goals && typeof d.goals === 'object' ? d.goals : {},
      }));
    const p = manifest.prefs && typeof manifest.prefs === 'object' ? manifest.prefs : null;
    return { documents, prefs: p, dismissals: Array.isArray(manifest.dismissals) ? manifest.dismissals : null };
  }
  const documents = Object.entries(entries)
    .filter(([name]) => /\.(md|markdown|txt)$/iu.test(name) && !/(^|\/)\./u.test(name))
    .map(([name, data]) => documentFromFile(name.split('/').pop(), strFromU8(data)));
  if (!documents.length) throw new Error('No Markdown or text files were found in that file.');
  return { documents, prefs: null, dismissals: null };
}

/** @param {string} name @param {string} text */
export function documentFromFile(name, text) {
  const { meta, body } = parseFrontMatter(text);
  const content = /\.txt$/iu.test(name) ? null : contentFromMarkdown(body);
  return {
    ...(meta.id ? { id: meta.id } : {}),
    title: meta.title ?? titleFromFilename(name),
    content,
    ...(content ? {} : { text: body }),
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    goals: meta.goals ?? {},
  };
}

/**
 * Merge read documents into storage: a document with a known id is updated
 * only when the import is newer; everything else is added.
 * @param {ReturnType<typeof readLibrary>['documents']} documents
 * @param {{ list: () => Promise<{ id: string, updatedAt: number }[]>, put: (doc: LibraryDocument) => Promise<void>, now?: () => number }} store
 * @returns {Promise<{ added: number, updated: number, skipped: number }>}
 */
export async function mergeDocuments(documents, { list, put, now = Date.now }) {
  const existing = new Map((await list()).map((d) => [d.id, d.updatedAt]));
  const counts = { added: 0, updated: 0, skipped: 0 };
  for (const d of documents) {
    if (!d.content) continue; // plain text is converted by the caller, which has the editor
    const current = d.id ? existing.get(d.id) : undefined;
    if (current !== undefined && current >= (d.updatedAt ?? 0)) {
      counts.skipped++;
      continue;
    }
    const t = now();
    await put({
      id: d.id ?? crypto.randomUUID(),
      title: d.title ?? 'Untitled',
      content: d.content,
      createdAt: d.createdAt ?? t,
      updatedAt: d.updatedAt ?? t,
      goals: d.goals ?? {},
    });
    if (current === undefined) counts.added++;
    else counts.updated++;
  }
  return counts;
}

/** Union lists from imported preferences into the current ones; nothing is removed. */
export function mergePrefs(current, imported) {
  if (!imported) return current;
  const union = (a, b) => [...new Set([...(a ?? []), ...(Array.isArray(b) ? b.filter((x) => typeof x === 'string') : [])])];
  return {
    ...current,
    dictionary: union(current.dictionary, imported.dictionary).sort((a, b) => a.localeCompare(b)),
    disabledRules: union(current.disabledRules, imported.disabledRules),
  };
}

export function libraryFilename(now = new Date()) {
  return `open-writer-library-${now.toISOString().slice(0, 10)}.zip`;
}
