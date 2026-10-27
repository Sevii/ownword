// Text handed to the editor by a landing page (sessionStorage) or the browser
// extension (window message). Either way it becomes a new document.

export const HANDOFF_KEY = 'ow:handoff';
const MAX_CHARS = 200_000;

/** @typedef {{ text: string, source: string, intent?: string }} Handoff */

/** Read and clear a pending landing-page handoff. @returns {Handoff | null} */
export function takeHandoff() {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(HANDOFF_KEY);
    const h = JSON.parse(raw);
    return typeof h?.text === 'string' && h.text.trim() ? { text: h.text.slice(0, MAX_CHARS), source: String(h.source ?? ''), intent: h.intent } : null;
  } catch {
    return null;
  }
}

const escape = (s) => s.replace(/[&<>"]/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Plain text as editor HTML. By default blank lines separate paragraphs and
 * single newlines become spaces (pasted prose is often hard-wrapped). With
 * `lines`, every line is its own paragraph, blank ones included, so
 * `linesText` gives the same text back (the extension's "Send back").
 */
export function textToHtml(text, { lines = false } = {}) {
  if (lines) {
    return text
      .slice(0, MAX_CHARS)
      .split(/\r?\n/u)
      .map((l) => (l ? `<p>${escape(l)}</p>` : '<p></p>'))
      .join('');
  }
  return text
    .slice(0, MAX_CHARS)
    .split(/\n\s*\n/u)
    .map((p) => p.replace(/\s*\n\s*/gu, ' ').trim())
    .filter(Boolean)
    .map((p) => `<p>${escape(p)}</p>`)
    .join('') || '<p></p>';
}

/**
 * The inverse of `textToHtml(text, { lines: true })`: one line per block.
 * @param {import('../analysis/types.js').Snapshot} snapshot
 */
export function linesText(snapshot) {
  return snapshot.blocks.map((b) => (b.type === 'listItem' ? `- ${b.text}` : b.text)).join('\n');
}

/** A short title from the first words. */
export function titleFrom(text, fallback = 'Pasted text') {
  const words = text.trim().split(/\s+/u).slice(0, 6).join(' ');
  return words ? (words.length > 48 ? `${words.slice(0, 47)}…` : words) : fallback;
}
