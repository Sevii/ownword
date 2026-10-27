// Readable progress from a partial JSON reply while it streams. Best effort
// and display-only: nothing here is validated or applied.

/**
 * The string values of `key` in a partial JSON text, including an unfinished
 * last one.
 * @param {string} partial @param {string} key
 * @returns {string[]}
 */
export function partialStrings(partial, key) {
  const out = [];
  const re = new RegExp(`"${key}"\\s*:\\s*"`, 'gu');
  let m;
  while ((m = re.exec(partial))) {
    let i = re.lastIndex;
    let s = '';
    while (i < partial.length && partial[i] !== '"') {
      if (partial[i] === '\\') {
        const next = partial[i + 1];
        if (next === undefined) break;
        if (next === 'u') {
          const hex = partial.slice(i + 2, i + 6);
          if (hex.length < 4) break;
          s += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        s += { n: ' ', t: ' ', r: '', b: '', f: '' }[next] ?? next;
        i += 2;
        continue;
      }
      s += partial[i];
      i++;
    }
    out.push(s);
    re.lastIndex = i;
  }
  return out;
}

/**
 * @param {'rewrite'|'findings'|'explanation'} kind
 * @param {string} partial
 * @returns {string}
 */
export function previewText(kind, partial) {
  if (kind === 'explanation') return partial;
  if (kind === 'rewrite') return partialStrings(partial, 'text').join('\n\n');
  const n = partialStrings(partial, 'quote').length;
  return n ? `Found ${n} ${n === 1 ? 'thing' : 'things'} to look at so far…` : 'Reading your text…';
}
