// The browser extension's content script and this page talk with window
// messages on this origin only. It delivers selected text; "Send back"
// returns the edited text. Split out of App.jsx (plan §0.2).

import { useEffect, useRef, useState } from 'react';
import { linesText } from '../../site/handoff.js';
import { count } from '../telemetry.js';

/**
 * @param {{
 *   prefsLoaded: boolean,
 *   importText: (text: string, title: string, opts?: { lines?: boolean }) => Promise<any>,
 *   currentRequest: () => any,
 *   announce: (text: string) => void,
 *   taskCompleted: () => void,
 * }} deps
 */
export function useExtensionBridge({ prefsLoaded, importText, currentRequest, announce, taskCompleted }) {
  // A document that came from the browser extension, which can send its text back.
  const [extensionLink, setExtensionLink] = useState(/** @type {null | { docId: string, from: string }} */ (null));
  const returnTextRef = useRef('');

  useEffect(() => {
    if (!prefsLoaded) return undefined;
    const onMessage = async (e) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const m = e.data;
      if (m?.source !== 'ow-extension') return;
      if (m.type === 'hello') window.postMessage({ source: 'ow-app', type: 'ready' }, window.location.origin);
      if (m.type === 'import' && typeof m.text === 'string' && m.text.trim()) {
        const from = typeof m.from === 'string' ? m.from.slice(0, 100) : 'another page';
        const created = await importText(m.text, `From ${from}`, { lines: true });
        if (created && m.returnable) setExtensionLink({ docId: created.id, from });
        count('extension.imported');
      } else if (m.type === 'returned') {
        if (m.ok) {
          announce(`Sent back to ${m.from ?? 'the page'}.`);
          count('extension.returned');
          return;
        }
        // The selection there changed or the page closed: never guess where the text goes.
        const copied = await navigator.clipboard.writeText(returnTextRef.current).then(() => true, () => false);
        announce(
          m.reason === 'changed'
            ? `The text on ${m.from ?? 'the page'} changed, so nothing was replaced.${copied ? ' Your text is on the clipboard.' : ''}`
            : `Could not reach ${m.from ?? 'the page'}; it may have closed.${copied ? ' Your text is on the clipboard.' : ''}`,
        );
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'ow-app', type: 'ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded]);

  function sendBack() {
    const req = currentRequest();
    if (!req || !extensionLink) return;
    returnTextRef.current = linesText(req.snapshot);
    window.postMessage({ source: 'ow-app', type: 'return', text: returnTextRef.current }, window.location.origin);
    taskCompleted();
  }

  return { extensionLink, sendBack };
}
