// Fast equality fingerprint for a block: FNV-1a over type, level, text, and
// marks. Not a security hash; the source text is always kept alongside it.

/** @param {string} s */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** @param {{ type: string, level?: number, text: string, marks: object[] }} block */
export function blockFingerprint(block) {
  return fnv1a(JSON.stringify([block.type, block.level ?? 0, block.text, block.marks]));
}
