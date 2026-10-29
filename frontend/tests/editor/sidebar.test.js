import { describe, it, expect } from 'vitest';
import { sortDocuments, filterDocuments, normalizeTag } from '../../src/app/Sidebar.jsx';
import { previewOf, contentFromMarkdown } from '../../src/documents/content.js';

const docs = [
  { id: 'a', title: 'Alpha notes', updatedAt: 3, tags: ['work'], preview: 'Quarterly numbers' },
  { id: 'b', title: 'Beta', updatedAt: 5, pinned: true, preview: 'Trip to Lisbon' },
  { id: 'c', title: 'Gamma', updatedAt: 9, tags: ['work', 'draft'], preview: '' },
];

describe('document list (plan §4.2)', () => {
  it('sorts pinned first, then most recent', () => {
    expect(sortDocuments(docs).map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });
  it('filters by title, first words, and tags, and by a chosen tag', () => {
    expect(filterDocuments(docs, 'lisbon', '').map((d) => d.id)).toEqual(['b']);
    expect(filterDocuments(docs, 'ALPHA', '').map((d) => d.id)).toEqual(['a']);
    expect(filterDocuments(docs, 'draft', '').map((d) => d.id)).toEqual(['c']);
    expect(filterDocuments(docs, '', 'work').map((d) => d.id)).toEqual(['a', 'c']);
    expect(filterDocuments(docs, 'gamma', 'work').map((d) => d.id)).toEqual(['c']);
    expect(filterDocuments(docs, '  ', '')).toHaveLength(3);
  });
  it('normalizes tags', () => {
    expect(normalizeTag(' #Big Idea ')).toBe('big-idea');
    expect(normalizeTag('x'.repeat(40))).toHaveLength(32);
    expect(normalizeTag('   ')).toBe('');
  });
  it('builds a short preview from content', () => {
    const p = previewOf(contentFromMarkdown('# Title\n\nFirst   line.\n\n- item\n'));
    expect(p).toBe('Title First line. - item');
    expect(previewOf(contentFromMarkdown(`${'word '.repeat(100)}`)).length).toBe(200);
    expect(previewOf({ bogus: true })).toBe('');
  });
});
