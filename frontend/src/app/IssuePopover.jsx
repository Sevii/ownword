import { useLayoutEffect, useRef } from 'react';
import { IssueBody } from './IssueCard.jsx';
import { IconClose } from './icons.jsx';

/**
 * A suggestion shown next to its underline, opened by clicking the text.
 * Positioned through the CSSOM (allowed by the CSP) from the underline's rect.
 */
export function IssuePopover({ issue, anchorEl, onClose, ...props }) {
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchorEl) return;
    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
      const below = r.bottom + 8;
      el.style.left = `${left}px`;
      el.style.top = `${below + h > window.innerHeight - 12 ? Math.max(12, r.top - h - 8) : below}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorEl, issue]);

  useLayoutEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    const onDown = (e) => {
      if (!ref.current?.contains(e.target) && !e.target.closest?.('[data-issue-id]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  if (!issue || !anchorEl) return null;
  return (
    <div ref={ref} className="popover" role="dialog" aria-label="Suggestion">
      <button type="button" className="icon-btn popover__close" aria-label="Close" onClick={onClose}>
        <IconClose />
      </button>
      <IssueBody issue={issue} stale={props.isStale(issue)} showActions {...props} />
    </div>
  );
}
