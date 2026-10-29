// Share links (improvement plan §5.1): the document travels inside the URL
// fragment, compressed. Fragments are never sent to the server, so nothing
// is stored or logged anywhere; whoever has the link has the text.

export const SHARE_PREFIX = '#share=';
export const MAX_SHARE_BYTES = 32 * 1024;

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/gu, '+').replace(/_/gu, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * @param {{ title: string, markdown: string }} doc
 * @returns {Promise<string>} the fragment, including "#share="
 * @throws when the compressed text is over MAX_SHARE_BYTES
 */
export async function encodeShare({ title, markdown }) {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, t: title ?? '', m: markdown }));
  const packed = await pipe(json, new CompressionStream('deflate-raw'));
  if (packed.length > MAX_SHARE_BYTES) {
    throw new Error(`This document is too long for a link (${Math.round(packed.length / 1024)} KB compressed; the limit is ${MAX_SHARE_BYTES / 1024} KB). Export it instead.`);
  }
  return SHARE_PREFIX + toBase64Url(packed);
}

/**
 * @param {string} fragment location.hash
 * @returns {Promise<{ title: string, markdown: string } | null>}
 */
export async function decodeShare(fragment) {
  if (!fragment?.startsWith(SHARE_PREFIX)) return null;
  try {
    const packed = fromBase64Url(fragment.slice(SHARE_PREFIX.length));
    if (packed.length > MAX_SHARE_BYTES * 2) return null;
    const json = JSON.parse(new TextDecoder().decode(await pipe(packed, new DecompressionStream('deflate-raw'))));
    if (json?.v !== 1 || typeof json.m !== 'string') return null;
    return { title: typeof json.t === 'string' ? json.t.slice(0, 200) : '', markdown: json.m.slice(0, 400_000) };
  } catch {
    return null;
  }
}

/** Read and clear a share fragment from the address bar. */
export async function takeShareLink() {
  if (typeof window === 'undefined' || !window.location.hash.startsWith(SHARE_PREFIX)) return null;
  const doc = await decodeShare(window.location.hash);
  // The fragment is cleared whether or not it decoded, so a reload does not import again.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return doc;
}

/** The full link for the current page. @param {string} fragment */
export function shareUrl(fragment) {
  return `${window.location.origin}${window.location.pathname}${fragment}`;
}
