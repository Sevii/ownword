import { useEffect, useState } from 'react';
import { IconBold, IconItalic, IconLink, IconList, IconOrdered, IconQuote, IconRedo, IconUndo, IconSearch } from './icons.jsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/** @param {{ editor: import('@tiptap/core').Editor | null, onFind?: () => void, findOpen?: boolean }} props */
export function FormatBar({ editor, onFind, findOpen = false }) {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const update = () => rerender((n) => n + 1);
    editor.on('transaction', update);
    return () => editor.off('transaction', update);
  }, [editor]);

  const chain = () => editor.chain().focus();
  const tool = (label, shortcut, active, run, icon, disabled = false) => (
    <button
      type="button"
      className={`fmt${icon ? '' : ' fmt--text'}`}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      disabled={!editor || disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {icon ?? label}
    </button>
  );

  function setLink() {
    const prev = editor.getAttributes('link').href ?? '';
    // Kept dependency-free; the Link extension rejects disallowed schemes.
    const href = window.prompt('Link address (https:// or mailto:)', prev);
    if (href === null) return;
    if (!href) chain().unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href }).run();
  }

  const on = (name, attrs) => !!editor?.isActive(name, attrs);
  return (
    <div className="formatbar" role="toolbar" aria-label="Formatting">
      <div className="formatbar__inner">
        {tool('H1 heading', `${mod}Alt+1`, on('heading', { level: 1 }), () => chain().toggleHeading({ level: 1 }).run(), <span>H1</span>)}
        {tool('H2 heading', `${mod}Alt+2`, on('heading', { level: 2 }), () => chain().toggleHeading({ level: 2 }).run(), <span>H2</span>)}
        <span className="formatbar__sep" />
        {tool('Bold', `${mod}B`, on('bold'), () => chain().toggleBold().run(), <IconBold />)}
        {tool('Italic', `${mod}I`, on('italic'), () => chain().toggleItalic().run(), <IconItalic />)}
        {tool('Link', null, on('link'), setLink, <IconLink />)}
        <span className="formatbar__sep" />
        {tool('Bulleted list', null, on('bulletList'), () => chain().toggleBulletList().run(), <IconList />)}
        {tool('Numbered list', null, on('orderedList'), () => chain().toggleOrderedList().run(), <IconOrdered />)}
        {tool('Quote', null, on('blockquote'), () => chain().toggleBlockquote().run(), <IconQuote />)}
        <span className="formatbar__sep" />
        {tool('Undo', `${mod}Z`, false, () => chain().undo().run(), <IconUndo />, !editor?.can().undo())}
        {tool('Redo', `${mod}Shift+Z`, false, () => chain().redo().run(), <IconRedo />, !editor?.can().redo())}
        <span className="formatbar__sep" />
        {tool('Find and replace', `${mod}F`, findOpen, () => onFind?.(), <IconSearch />)}
      </div>
    </div>
  );
}
