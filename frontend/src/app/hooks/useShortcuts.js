// Global keyboard shortcuts. Split out of App.jsx (plan §0.2).

import { useEffect } from 'react';

/**
 * @param {{
 *   moveIssue: (delta: number) => void,
 *   save: () => Promise<void>,
 *   toggleFocus: () => void,
 *   onEscape: () => void, when no popover is open
 * }} handlers
 */
export function useShortcuts({ moveIssue, save, toggleFocus, onEscape }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        moveIssue(e.key === 'ArrowDown' ? 1 : -1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFocus();
      }
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
