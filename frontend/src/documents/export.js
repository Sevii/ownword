// Export to plain text, Markdown, and .docx; import from .docx. All work on
// snapshots so they share the editor's schema.

/** @typedef {import('../analysis/types.js').Snapshot} Snapshot */
/** @typedef {import('../analysis/types.js').Block} Block */

/** @param {Snapshot} snapshot */
export function toPlainText(snapshot) {
  return withListNumbers(snapshot.blocks, (b, n) => {
    if (b.type === 'listItem') return `${n ? `${n}.` : '-'} ${b.text}`;
    return b.text;
  });
}

/** @param {Snapshot} snapshot */
export function toMarkdown(snapshot) {
  return withListNumbers(snapshot.blocks, (b, n) => {
    if (b.type === 'codeBlock') return `\`\`\`\n${b.text}\n\`\`\``;
    const inline = inlineMarkdown(b);
    if (b.type === 'heading') return `${'#'.repeat(b.level ?? 1)} ${inline}`;
    if (b.type === 'listItem') return `${n ? `${n}.` : '-'} ${inline}`;
    if (b.type === 'blockquote') return `> ${inline}`;
    return inline;
  });
}

// Snapshots do not record list kind, so lists export as bullets. Join list
// items with single newlines and other blocks with blank lines.
function withListNumbers(blocks, render) {
  const out = [];
  blocks.forEach((b, i) => {
    const line = render(b, 0);
    const prev = blocks[i - 1];
    const sep = i === 0 ? '' : b.type === 'listItem' && prev?.type === 'listItem' ? '\n' : '\n\n';
    out.push(sep + line);
  });
  return `${out.join('')}\n`;
}

/** @param {Block} b */
function inlineMarkdown(b) {
  const escape = (s) => s.replace(/([\\`*_[\]])/gu, '\\$1');
  const opens = new Map();
  const closes = new Map();
  for (const m of b.marks) {
    const [o, c] =
      m.type === 'bold' ? ['**', '**']
      : m.type === 'italic' ? ['*', '*']
      : m.type === 'code' ? ['`', '`']
      : ['[', `](${m.href})`];
    opens.set(m.from, (opens.get(m.from) ?? '') + o);
    closes.set(m.to, c + (closes.get(m.to) ?? ''));
  }
  // Backslashes are literal inside a code span, so its text is not escaped.
  const inCode = (i) => b.marks.some((m) => m.type === 'code' && m.from <= i && i < m.to);
  let out = '';
  for (let i = 0; i <= b.text.length; i++) {
    out += closes.get(i) ?? '';
    out += opens.get(i) ?? '';
    if (i < b.text.length) out += inCode(i) ? b.text[i] : escape(b.text[i]);
  }
  return out;
}

/**
 * @param {Snapshot} snapshot
 * @returns {Promise<Blob>}
 */
export async function toDocx(snapshot) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } = await import('docx');
  const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const children = snapshot.blocks.map((b) => {
    const runs = segments(b).map((seg) => {
      const run = new TextRun({ text: seg.text, bold: seg.bold, italics: seg.italic, font: seg.code ? 'Courier New' : undefined, style: seg.href ? 'Hyperlink' : undefined });
      return seg.href ? new ExternalHyperlink({ link: seg.href, children: [run] }) : run;
    });
    if (b.type === 'heading') return new Paragraph({ heading: headings[(b.level ?? 1) - 1], children: runs });
    if (b.type === 'listItem') return new Paragraph({ bullet: { level: 0 }, children: runs });
    if (b.type === 'blockquote') return new Paragraph({ indent: { left: 720 }, children: runs });
    if (b.type === 'codeBlock') {
      return new Paragraph({ children: [new TextRun({ text: b.text, font: 'Courier New' })] });
    }
    return new Paragraph({ children: runs });
  });
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

/** Split a block into runs of uniform formatting. @param {Block} b */
function segments(b) {
  const cuts = new Set([0, b.text.length]);
  for (const m of b.marks) {
    cuts.add(m.from);
    cuts.add(m.to);
  }
  const points = [...cuts].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const active = b.marks.filter((m) => m.from <= from && m.to >= to);
    out.push({
      text: b.text.slice(from, to),
      bold: active.some((m) => m.type === 'bold'),
      italic: active.some((m) => m.type === 'italic'),
      code: active.some((m) => m.type === 'code'),
      href: active.find((m) => m.type === 'link')?.href,
    });
  }
  return out;
}

/**
 * Convert a .docx file to HTML for the editor. The caller sanitizes it and
 * the editor schema drops anything unsupported.
 * @param {ArrayBuffer} buffer
 */
export async function docxToHtml(buffer) {
  const mammoth = await import('mammoth');
  // The browser build takes an ArrayBuffer; the Node build (tests) a Buffer.
  const input = typeof globalThis.Buffer === 'function' ? { buffer: globalThis.Buffer.from(buffer) } : { arrayBuffer: buffer };
  const { value, messages } = await (mammoth.default ?? mammoth).convertToHtml(input);
  return { html: value, warnings: messages.filter((m) => m.type === 'warning').map((m) => m.message) };
}

/** @param {Blob} blob @param {string} filename */
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {string} title */
export function safeFilename(title) {
  return (title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, ' ').trim().slice(0, 80) || 'Untitled';
}
