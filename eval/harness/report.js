// Markdown rendering of an eval report.

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function renderMarkdown(report) {
  const s = report.summary;
  const lines = [
    `# Eval report: ${report.label}`,
    '',
    `${report.date} · split \`${report.split}\` · engines ${report.engines.join(', ')} · ${report.elapsedMs} ms`,
    '',
    `Versions: harness ${report.versions.harness}, harper ${report.versions.harper ?? '-'}, rules ${report.versions.rules ?? '-'}, corpus ${report.versions.corpus}`,
    '',
    '## Summary',
    '',
    '| Measure | Value | Raw |',
    '| --- | --- | --- |',
    `| Correction precision | ${pct(s.correction.precision)} | ${s.correction.detections - s.correction.falsePositives} / ${s.correction.detections} |`,
    `| Recall (overlap) | ${pct(s.correction.recallLenient)} | ${s.correction.foundLenient} / ${s.correction.expected} |`,
    `| Recall (overlap + category) | ${pct(s.correction.recallStrict)} | ${s.correction.foundStrict} / ${s.correction.expected} |`,
    `| Fix accuracy | ${pct(s.correction.fixAccuracy)} | of matched issues with accepted fixes |`,
    `| Clean-text false positives | ${s.cleanText.perThousandWords?.toFixed(2) ?? 'n/a'} per 1k words | ${s.cleanText.falsePositives} in ${s.cleanText.words} words |`,
    `| Forbidden spans touched by a replacement | ${s.forbiddenTouched} | |`,
    `| Style observations | ${s.style.detections} | ${s.style.onAnnotated} on annotated spans |`,
    `| Rejected anchors | ${s.rejectedAnchors} | |`,
    '',
    `Cases: ${s.cases} (${s.cleanCases} clean), ${s.words} words.`,
    '',
    '## By category (likely errors)',
    '',
    '| Category | Expected | Found | Recall | Detections | False positives | Precision |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...Object.entries(s.categories)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, v]) => `| ${cat} | ${v.expected} | ${v.found} | ${pct(v.recall)} | ${v.detections} | ${v.falsePositives} | ${pct(v.precision)} |`),
    '',
  ];
  const withFps = report.cases.filter((c) => c.falsePositives.length);
  if (withFps.length) {
    lines.push('## False positives', '');
    for (const c of withFps) {
      for (const fp of c.falsePositives) {
        lines.push(`- \`${c.id}\` ${fp.rule} (${fp.category}): “${fp.text}” → ${fp.replacements.map((r) => `“${r}”`).join(', ') || '(no replacement)'}`);
      }
    }
    lines.push('');
  }
  const withMisses = report.cases.filter((c) => c.missed.length);
  if (withMisses.length) {
    lines.push('## Missed', '');
    for (const c of withMisses) lines.push(`- \`${c.id}\`: ${c.missed.map((m) => `“${m.quote}” (${m.category})`).join(', ')}`);
    lines.push('');
  }
  const touched = report.cases.filter((c) => c.forbiddenTouched.length);
  if (touched.length) {
    lines.push('## Forbidden spans touched', '');
    for (const c of touched) for (const t of c.forbiddenTouched) lines.push(`- \`${c.id}\` ${t.rule}: “${t.text}” → ${t.replacements.join(', ')}`);
    lines.push('');
  }
  if (report.caseErrors.length) {
    lines.push('## Case errors', '');
    for (const e of report.caseErrors) lines.push(`- \`${e.file}\`: ${e.problems.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
