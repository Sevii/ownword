import { describe, it, expect } from 'vitest';
import { memoryFolder, writeDocument, reconcile, fileNameFor } from '../../src/documents/folder-sync.js';
import { contentFromMarkdown, markdownFromContent, parseFrontMatter } from '../../src/documents/content.js';

function makeStore(initial = []) {
  const docs = new Map(initial.map((d) => [d.id, d]));
  let n = 0;
  return {
    docs,
    list: async () => [...docs.values()].map(({ content: _c, ...rest }) => rest),
    get: async (id) => docs.get(id),
    put: async (d) => { docs.set(d.id, d); },
    create: async (init) => { const d = { id: `new-${++n}`, createdAt: 5, updatedAt: 5, goals: {}, ...init }; docs.set(d.id, d); return d; },
  };
}
const doc = (id, title, text, updatedAt) => ({ id, title, content: contentFromMarkdown(text), createdAt: 1, updatedAt, goals: {} });

describe('folder sync (plan §3.2)', () => {
  it('writes Markdown with front matter and renames the file when the title changes', async () => {
    const folder = memoryFolder();
    let entry = await writeDocument(folder, doc('a1', 'My Plan', 'Hello.\n', 10), {});
    expect(entry).toMatchObject({ fileName: 'My Plan.md', updatedAt: 10 });
    expect(parseFrontMatter(folder.files.get('My Plan.md').text).meta).toMatchObject({ id: 'a1', title: 'My Plan' });
    entry = await writeDocument(folder, doc('a1', 'Our Plan', 'Hello.\n', 11), { a1: entry });
    expect([...folder.files.keys()]).toEqual(['Our Plan.md']);
    // Two documents with the same title keep separate files.
    const other = await writeDocument(folder, doc('b2222222-x', 'Our Plan', 'Other.\n', 12), { a1: entry });
    expect(other.fileName).toBe('Our Plan-b2222222.md');
    expect(fileNameFor('', 'zz9-abc')).toBe('Untitled.md');
  });

  it('writes documents that have no file, imports unknown files, and loads files changed on disk', async () => {
    const folder = memoryFolder({ 'Trip.md': '# Trip\n\nPack.\n' });
    const store = makeStore([doc('a1', 'Plan', 'Plan text.\n', 10)]);
    const r1 = await reconcile(folder, { index: {}, ...store });
    expect(r1).toMatchObject({ added: 1, loaded: 0, written: 1, conflicts: [] });
    expect(store.docs.get('new-1')).toMatchObject({ title: 'Trip' });
    expect(folder.files.has('Plan.md')).toBe(true);

    // Edited by another app, not here: loaded without asking.
    folder.touch('Plan.md', '---\nid: a1\ntitle: "Plan"\n---\nPlan text, revised.\n');
    const r2 = await reconcile(folder, { index: r1.index, ...store });
    expect(r2).toMatchObject({ loaded: 1, conflicts: [] });
    expect(markdownFromContent(store.docs.get('a1').content)).toBe('Plan text, revised.\n');

    // Edited in both places: a conflict for the user.
    folder.touch('Plan.md', '---\nid: a1\n---\nDisk again.\n');
    store.docs.set('a1', { ...store.docs.get('a1'), updatedAt: r2.index.a1.updatedAt + 1000 });
    const r3 = await reconcile(folder, { index: r2.index, ...store });
    expect(r3.conflicts).toEqual([expect.objectContaining({ id: 'a1', fileName: 'Plan.md' })]);
    expect(markdownFromContent(store.docs.get('a1').content)).toBe('Plan text, revised.\n');

    // Deleted on disk: forgotten, not re-created.
    folder.files.delete('Plan.md');
    const r4 = await reconcile(folder, { index: r3.index, ...store });
    expect(r4.index.a1).toBeUndefined();
    expect(folder.files.has('Plan.md')).toBe(false);
  });

  it('matches a file by name when it has no front matter id, and prefers our newer copy on first connect', async () => {
    const folder = memoryFolder({ 'Plan.md': 'Old on disk.\n' });
    const store = makeStore([doc('a1', 'Plan', 'Newer here.\n', 2000)]);
    const index = { a1: { fileName: 'Plan.md', lastModified: 0, updatedAt: 0 } };
    const r = await reconcile(folder, { index, ...store });
    expect(r.conflicts).toHaveLength(1); // edited here since the (empty) last write, and changed on disk
    const fresh = makeStore([doc('a1', 'Plan', 'Newer here.\n', 9e12)]);
    const r2 = await reconcile(memoryFolder({ 'Plan.md': '---\nid: a1\nupdated: 2020-01-01T00:00:00Z\n---\nOld.\n' }), { index: {}, ...fresh });
    expect(r2).toMatchObject({ written: 1, loaded: 0, added: 0 });
  });
});
