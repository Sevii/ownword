// Export in every supported format, and the local "a task was completed"
// marker. Imports live in useDocuments because they create documents.

import { toPlainText, toMarkdown, toDocx, download, safeFilename } from '../../documents/export.js';
import { encodeShare, shareUrl } from '../../site/share.js';
import { count } from '../telemetry.js';

/**
 * @param {{ currentRequest: () => any, docRef: React.MutableRefObject<any>, announce: (text: string) => void }} deps
 */
export function useImportExport({ currentRequest, docRef, announce }) {
  async function exportAs(kind) {
    const req = currentRequest();
    if (!req) return;
    const name = safeFilename(docRef.current.title);
    if (kind === 'print') {
      // The print stylesheet shows the document alone; the browser's dialog saves a PDF.
      window.print();
      count('export.print');
      return;
    }
    if (kind === 'share') {
      try {
        const fragment = await encodeShare({ title: docRef.current.title, markdown: toMarkdown(req.snapshot) });
        await navigator.clipboard.writeText(shareUrl(fragment));
        announce(`Link copied (${Math.max(1, Math.round(fragment.length / 1024))} KB). The text is inside the link itself, not on any server, so anyone with the link can read it.`);
        count('export.share');
      } catch (err) {
        announce(err?.message ?? 'Could not make a link.');
      }
      return;
    }
    if (kind === 'copy') {
      await navigator.clipboard.writeText(toPlainText(req.snapshot));
      announce('Copied to the clipboard.');
    } else if (kind === 'txt') {
      download(new Blob([toPlainText(req.snapshot)], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
    } else if (kind === 'md') {
      download(new Blob([toMarkdown(req.snapshot)], { type: 'text/markdown;charset=utf-8' }), `${name}.md`);
    } else {
      download(await toDocx(req.snapshot), `${name}.docx`);
    }
    count(`export.${kind}`);
    taskCompleted();
  }

  /** First and repeat completed tasks (export, or applying an AI result). The flag stays in this browser; no identifier is sent. */
  function taskCompleted() {
    let first = false;
    try {
      first = !localStorage.getItem('ow:task-done');
      localStorage.setItem('ow:task-done', '1');
    } catch {
      // Storage blocked: count as a repeat.
    }
    count(first ? 'task.completed.first' : 'task.completed.repeat');
  }

  return { exportAs, taskCompleted };
}
