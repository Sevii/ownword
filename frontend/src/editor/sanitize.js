// Link and pasted-HTML policy (plan §7.5). The editor schema already drops
// unsupported nodes and attributes; this removes unsafe link destinations and
// executable content before parsing, for paste, .docx import, and saved data.

const ALLOWED_SCHEMES = /^(?:https?:|mailto:)/iu;

/** @param {string | null | undefined} href */
export function isAllowedHref(href) {
  if (!href) return false;
  const trimmed = href.trim().replace(/[\u0000-\u001f\u007f\s]/gu, '');
  return ALLOWED_SCHEMES.test(trimmed);
}

/**
 * @param {string} html
 * @returns {string}
 */
export function sanitizePastedHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, template, svg, math, form').forEach((el) => el.remove());
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      // A pasted block ID would collide with the block it was copied from.
      if (name.startsWith('on') || name === 'style' || name === 'srcdoc' || name === 'src' || name === 'data-block-id') {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A' && !isAllowedHref(el.getAttribute('href'))) el.replaceWith(...el.childNodes);
  }
  return doc.body.innerHTML;
}

/**
 * Remove disallowed link marks from saved Tiptap JSON before loading it.
 * @param {any} json
 */
export function sanitizeDocJson(json) {
  if (!json || typeof json !== 'object') return json;
  const out = { ...json };
  if (Array.isArray(out.marks)) {
    out.marks = out.marks.filter((m) => m.type !== 'link' || isAllowedHref(m.attrs?.href));
  }
  if (Array.isArray(out.content)) out.content = out.content.map(sanitizeDocJson);
  return out;
}
