// Inline SVG icons (24px grid, 1.8 stroke). Decorative by default; give the
// surrounding button an accessible name.

function Icon({ children, ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

export const IconMenu = () => <Icon><path d="M4 6h16M4 12h16M4 18h16" /></Icon>;
export const IconBold = () => <Icon strokeWidth="2.2"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" /></Icon>;
export const IconItalic = () => <Icon><path d="M10 5h8M6 19h8M14 5l-4 14" /></Icon>;
export const IconList = () => <Icon><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Icon>;
export const IconOrdered = () => <Icon><path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5c0-1 .8-1.5 1.5-1.5s1.5.5 1.5 1.3c0 1.2-3 2.2-3 3.7h3" /></Icon>;
export const IconQuote = () => <Icon><path d="M7 7c-2 1-3 3-3 6v4h5v-5H6M17 7c-2 1-3 3-3 6v4h5v-5h-3" /></Icon>;
export const IconLink = () => <Icon><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Icon>;
export const IconUndo = () => <Icon><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" /></Icon>;
export const IconRedo = () => <Icon><path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" /></Icon>;
export const IconTarget = () => <Icon><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></Icon>;
export const IconExport = () => <Icon><path d="M12 15V4M8 8l4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></Icon>;
export const IconSettings = () => <Icon><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Icon>;
export const IconFocus = () => <Icon><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></Icon>;
export const IconClose = () => <Icon><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const IconSearch = () => <Icon><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></Icon>;
export const IconCheck = () => <Icon strokeWidth="2.4"><path d="M5 12.5l4.5 4.5L19 7" /></Icon>;
export const IconPlus = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const IconUpload = () => <Icon><path d="M12 4v11M8 11l4 4 4-4M5 20h14" /></Icon>;
export const IconLock = () => <Icon><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
export const IconReview = () => <Icon><path d="M4 5h16v11H8l-4 4z" /><path d="M8 10h8M8 13h5" /></Icon>;
