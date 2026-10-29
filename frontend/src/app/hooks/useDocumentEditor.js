// The Tiptap editor for the open document, its issue decorations, and the
// size of the current selection. Split out of App.jsx (plan §0.2).

import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '@tiptap/react';
import { editorExtensions, issueKey, issueDecorations, ENSURE_BLOCK_IDS } from '../../editor/extensions.js';
import { sanitizeDocJson } from '../../editor/sanitize.js';
import { countWords } from '../../analysis/text/segment.js';

/**
 * @param {{
 *   doc: any, loadKey: number,
 *   editorRef: React.MutableRefObject<import('@tiptap/core').Editor | null>,
 *   pendingImport: React.MutableRefObject<{ html: string, parseOptions?: object } | null>,
 *   proofreading: ReturnType<typeof import('./useProofreading.js').useProofreading>,
 *   scheduleSave: () => void,
 * }} deps
 */
export function useDocumentEditor({ doc, loadKey, editorRef, pendingImport, proofreading, scheduleSave }) {
  const { findings, activeId, setActiveId, setPopover, revealRef, revealTick, rangesRef, schedulerRef, updateProfile, onEditorUpdate } = proofreading;
  const [selectionWords, setSelectionWords] = useState(0);

  // Built once per load; the editor only reads them when it is created.
  const extensions = useMemo(
    () =>
      editorExtensions({
        onIssueClick: (id) => {
          setActiveId(id);
          setPopover({ id, el: null });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const content = useMemo(() => (doc ? sanitizeDocJson(doc.content) : ''), [doc?.id, loadKey]);

  const editor = useEditor(
    {
      extensions,
      content,
      injectCSS: false,
      immediatelyRender: true,
      // Read-only until the document has loaded: anything typed earlier would be
      // replaced when it arrives.
      editable: Boolean(doc),
      shouldRerenderOnTransaction: false,
      editorProps: { attributes: { class: 'prose', 'aria-label': 'Document', spellcheck: 'false', id: 'document' } },
      onCreate: ({ editor: ed }) => {
        editorRef.current = ed;
        ed.view.dispatch(ed.state.tr.setMeta(ENSURE_BLOCK_IDS, true).setMeta('addToHistory', false));
        if (pendingImport.current) {
          const { html, parseOptions } = pendingImport.current;
          // Not an edit: imported text must not be undoable, and an edit made
          // right after it must not join it in one undo step.
          ed.chain().setMeta('addToHistory', false).setContent(html, { parseOptions }).run();
          pendingImport.current = null;
        }
        updateProfile();
        schedulerRef.current?.schedule(true);
      },
      onUpdate: ({ transaction }) => {
        onEditorUpdate(transaction);
        scheduleSave();
      },
    },
    [doc?.id, loadKey],
  );
  editorRef.current = editor;

  // Keep decorations in sync with findings and the active issue.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // Ranges are mapped through every edit, so they stay right after the check's snapshot ages.
    const decorations = issueDecorations(findings, rangesRef.current, activeId);
    editor.view.dispatch(editor.state.tr.setMeta(issueKey, { decorations }).setMeta('addToHistory', false));
    // Decoration elements are re-rendered above, so look them up afterwards.
    const elFor = (id) => editor.view.dom.querySelector(`[data-issue-id="${CSS.escape(id)}"]`);
    if (revealRef.current) {
      const el = elFor(revealRef.current);
      revealRef.current = null;
      if (el) {
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
        el.classList.remove('issue--flash');
        void el.getBoundingClientRect();
        el.classList.add('issue--flash');
      }
    }
    setPopover((p) => (p && (!p.el || !p.el.isConnected) ? { ...p, el: elFor(p.id) } : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, findings, activeId, revealTick]);

  // How much is selected, for the AI panel's scope choice.
  useEffect(() => {
    if (!editor) return undefined;
    const onSelection = () => {
      const { from, to } = editor.state.selection;
      setSelectionWords(from === to ? 0 : countWords(editor.state.doc.textBetween(from, to, ' ')));
    };
    editor.on('selectionUpdate', onSelection);
    editor.on('update', onSelection);
    return () => {
      editor.off('selectionUpdate', onSelection);
      editor.off('update', onSelection);
    };
  }, [editor]);

  return { editor, selectionWords };
}
