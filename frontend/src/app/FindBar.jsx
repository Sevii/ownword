import { useEffect, useRef, useState } from 'react';
import { findState } from '../editor/find.js';
import { IconClose } from './icons.jsx';

/**
 * Find and replace within the document (plan §4.1). The editor's plugin
 * holds the matches; this bar edits the query and drives the commands.
 * @param {{ editor: import('@tiptap/core').Editor | null, onClose: () => void }} props
 */
export function FindBar({ editor, onClose }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [, rerender] = useState(0);
  const findInput = useRef(/** @type {HTMLInputElement | null} */ (null));

  useEffect(() => {
    findInput.current?.focus();
    findInput.current?.select();
  }, []);

  useEffect(() => {
    if (!editor) return undefined;
    const update = () => rerender((n) => n + 1);
    editor.on('transaction', update);
    return () => editor.off('transaction', update);
  }, [editor]);

  useEffect(() => {
    editor?.commands.setSearch({ query, caseSensitive, wholeWord });
  }, [editor, query, caseSensitive, wholeWord]);

  // Leaving the bar clears the highlights.
  useEffect(() => () => editor?.commands.clearSearch(), [editor]);

  const state = editor ? findState(editor.state) : null;
  const total = state?.matches.length ?? 0;
  const current = state && state.active >= 0 ? state.active + 1 : 0;
  const none = total === 0;

  const onFindKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) editor?.commands.findPrevious();
      else editor?.commands.findNext();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      editor?.commands.focus();
    }
  };
  const onReplaceKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      editor?.commands.replaceMatch(replacement);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      editor?.commands.focus();
    }
  };

  return (
    <div className="findbar" role="search" aria-label="Find and replace">
      <div className="findbar__group">
        <label className="visually-hidden" htmlFor="find-query">Find</label>
        <input id="find-query" ref={findInput} type="text" placeholder="Find" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onFindKey} spellCheck={false} />
        <span className="findbar__count" aria-live="polite">{query ? (none ? 'No matches' : `${current} of ${total}`) : ''}</span>
        <button type="button" className="btn btn--sm btn--ghost" disabled={none} onClick={() => editor?.commands.findPrevious()} aria-label="Previous match">↑</button>
        <button type="button" className="btn btn--sm btn--ghost" disabled={none} onClick={() => editor?.commands.findNext()} aria-label="Next match">↓</button>
      </div>
      <div className="findbar__group">
        <label className="visually-hidden" htmlFor="find-replacement">Replace with</label>
        <input id="find-replacement" type="text" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} onKeyDown={onReplaceKey} spellCheck={false} />
        <button type="button" className="btn btn--sm btn--secondary" disabled={none || current === 0} onClick={() => editor?.commands.replaceMatch(replacement)}>Replace</button>
        <button type="button" className="btn btn--sm btn--secondary" disabled={none} onClick={() => editor?.commands.replaceAllMatches(replacement)}>Replace all</button>
      </div>
      <label className="findbar__opt"><input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> Match case</label>
      <label className="findbar__opt"><input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word</label>
      <button type="button" className="btn btn--sm btn--ghost" aria-label="Close find" onClick={() => { onClose(); editor?.commands.focus(); }}><IconClose /></button>
    </div>
  );
}
