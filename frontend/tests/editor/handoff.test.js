// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions, ENSURE_BLOCK_IDS } from '../../src/editor/extensions.js';
import { snapshotFromDoc } from '../../src/editor/snapshot-from-editor.js';
import { textToHtml, linesText } from '../../src/site/handoff.js';

let editor;
afterEach(() => editor?.destroy());

/** Load text the way App.importText does for the extension, and read it back for "Send back". */
function roundTrip(text) {
  editor = new Editor({ extensions: editorExtensions({ onIssueClick: null }), injectCSS: false });
  editor.commands.setContent(textToHtml(text, { lines: true }), { parseOptions: { preserveWhitespace: 'full' } });
  editor.view.dispatch(editor.state.tr.setMeta(ENSURE_BLOCK_IDS, true));
  return linesText(snapshotFromDoc(editor.state.doc, { documentId: 'd', revision: 1, settingsRevision: 0 }).snapshot);
}

describe('handoff text', () => {
  it('reflows pasted prose by default', () => {
    expect(textToHtml('One line\nwrapped.\n\nNext <b>.')).toBe('<p>One line wrapped.</p><p>Next &lt;b&gt;.</p>');
  });

  it('keeps every line of extension text, so sending it back unedited changes nothing', () => {
    const text = 'Hi Bob,\nThanks\n\n- item 1\n- item 2\n    indented  twice\n';
    expect(roundTrip(text)).toBe(text);
    expect(roundTrip('one line')).toBe('one line');
  });
});
