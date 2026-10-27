// Coordinate conversions. Canonical offsets are zero-based UTF-16 code units,
// half-open [from, to), block-local (docs/review-contracts-and-evaluation.md §2).
// Engines may report Unicode scalar offsets; Rust reports UTF-8 bytes.

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** @param {string} text @param {number} scalar @returns {number} UTF-16 offset, or -1 if out of range */
export function scalarToUtf16(text, scalar) {
  if (!Number.isInteger(scalar) || scalar < 0) return -1;
  let u16 = 0;
  let n = 0;
  while (n < scalar) {
    if (u16 >= text.length) return -1;
    const cp = text.codePointAt(u16);
    u16 += cp > 0xffff ? 2 : 1;
    n++;
  }
  return u16;
}

/** @param {string} text @param {number} u16 @returns {number} scalar offset, or -1 if out of range or inside a surrogate pair */
export function utf16ToScalar(text, u16) {
  if (!Number.isInteger(u16) || u16 < 0 || u16 > text.length) return -1;
  if (splitsSurrogatePair(text, u16)) return -1;
  let n = 0;
  for (let i = 0; i < u16; ) {
    i += text.codePointAt(i) > 0xffff ? 2 : 1;
    n++;
  }
  return n;
}

/** @param {string} text @param {number} u16 @returns {number} UTF-8 byte offset, or -1 */
export function utf16ToUtf8(text, u16) {
  if (!Number.isInteger(u16) || u16 < 0 || u16 > text.length) return -1;
  if (splitsSurrogatePair(text, u16)) return -1;
  let bytes = 0;
  for (let i = 0; i < u16; ) {
    const cp = text.codePointAt(i);
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return bytes;
}

/** @param {string} text @param {number} byte @returns {number} UTF-16 offset, or -1 if out of range or mid-character */
export function utf8ToUtf16(text, byte) {
  if (!Number.isInteger(byte) || byte < 0) return -1;
  let bytes = 0;
  let i = 0;
  while (bytes < byte) {
    if (i >= text.length) return -1;
    const cp = text.codePointAt(i);
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return bytes === byte ? i : -1;
}

/** @param {string} text @param {number} u16 */
export function splitsSurrogatePair(text, u16) {
  if (u16 <= 0 || u16 >= text.length) return false;
  const prev = text.charCodeAt(u16 - 1);
  const next = text.charCodeAt(u16);
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

const boundaryCache = new Map();

/** Grapheme cluster boundaries of `text`, including 0 and text.length. */
export function graphemeBoundaries(text) {
  let set = boundaryCache.get(text);
  if (set) return set;
  set = new Set([0, text.length]);
  for (const { index } of graphemes.segment(text)) set.add(index);
  if (boundaryCache.size > 500) boundaryCache.clear();
  boundaryCache.set(text, set);
  return set;
}

/** @param {string} text @param {number} u16 */
export function isGraphemeBoundary(text, u16) {
  return graphemeBoundaries(text).has(u16);
}

/**
 * A range is usable for display and replacement when it lies inside the text
 * and both ends fall on grapheme boundaries.
 * @param {string} text @param {number} from @param {number} to
 */
export function isValidRange(text, from, to) {
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    from <= to &&
    to <= text.length &&
    isGraphemeBoundary(text, from) &&
    isGraphemeBoundary(text, to)
  );
}
