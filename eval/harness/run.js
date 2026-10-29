#!/usr/bin/env node
// Eval runner. Usage (from frontend/):
//   npm run eval -- [--split dev|heldout] [--engines harper,rules] [--label name] [--save] [--smoke]
// Held-out runs require HELDOUT=1 and are logged to reports/heldout-exposure.log.
// --save writes reports/<date>-<label>.{json,md}; every run writes reports/latest.{json,md}.

import { writeFileSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadCases, prepareCase, EVAL_DIR } from './cases.js';
import { scoreCase, aggregate } from './score.js';
import { renderMarkdown } from './report.js';
import { analyze } from '../../frontend/src/analysis/pipeline.js';
import { createNodeHarperEngine } from '../../frontend/src/analysis/engines/harper-node.js';
import { createRulesEngine, RULES_VERSION } from '../../frontend/src/analysis/rules/index.js';
import { HARPER_VERSION } from '../../frontend/src/analysis/engines/harper.js';

// 2: fix accuracy compares resulting text, not replacement strings.
export const HARNESS_VERSION = '2';

const { values: args } = parseArgs({
  options: {
    split: { type: 'string', default: 'dev' },
    engines: { type: 'string', default: 'harper,rules' },
    label: { type: 'string', default: '' },
    save: { type: 'boolean', default: false },
    smoke: { type: 'boolean', default: false },
  },
});

const split = /** @type {'dev'|'heldout'} */ (args.split);
if (split === 'heldout' && process.env.HELDOUT !== '1') {
  console.error('Refusing to run held-out cases without HELDOUT=1. Held-out exposure is logged; see docs/foundation-build-plan.md §5.4.');
  process.exit(2);
}

const ENGINE_FACTORIES = {
  harper: () => createNodeHarperEngine(),
  'harper-raw': () => createNodeHarperEngine({ policy: false }),
  rules: () => createRulesEngine(),
};
const engineNames = args.engines.split(',').map((s) => s.trim()).filter(Boolean);
for (const n of engineNames) if (!(n in ENGINE_FACTORIES)) throw new Error(`unknown engine ${n}`);
const engines = engineNames.map((n) => ENGINE_FACTORIES[n]());
await Promise.all(engines.map((e) => e.setup()));

let cases = loadCases(split);
if (args.smoke) cases = cases.slice(0, 10);
const caseErrors = [];
const results = [];
const corpusHash = createHash('sha256');
const started = performance.now();
for (const { file, case: c } of cases) {
  corpusHash.update(readFileSync(join(EVAL_DIR, 'corpus', file)));
  const prepared = prepareCase(c);
  if (prepared.problems.length) {
    caseErrors.push({ file, problems: prepared.problems });
    continue;
  }
  const settings = { dialect: c.dialect, goals: c.goals ?? {} };
  const { envelope } = await analyze(prepared.snapshot, settings, { engines, requestId: `eval-${c.id}` });
  results.push(scoreCase(prepared, c, envelope));
}
const elapsedMs = Math.round(performance.now() - started);

const label = args.label || engineNames.join('+');
const report = {
  label,
  date: new Date().toISOString(),
  split,
  versions: {
    harness: HARNESS_VERSION,
    harper: engineNames.some((n) => n.startsWith('harper')) ? HARPER_VERSION : null,
    rules: engineNames.includes('rules') ? RULES_VERSION : null,
    corpus: corpusHash.digest('hex').slice(0, 12),
  },
  engines: engineNames,
  elapsedMs,
  caseErrors,
  summary: aggregate(results),
  cases: results,
};

const reportsDir = join(EVAL_DIR, 'reports');
mkdirSync(reportsDir, { recursive: true });
const md = renderMarkdown(report);
writeFileSync(join(reportsDir, 'latest.json'), JSON.stringify(report, null, 2));
writeFileSync(join(reportsDir, 'latest.md'), md);
if (args.save) {
  const stem = `${report.date.slice(0, 10)}-${split}-${label}`.replace(/[^\w.+-]/gu, '_');
  writeFileSync(join(reportsDir, `${stem}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(reportsDir, `${stem}.md`), md);
}
if (split === 'heldout') {
  appendFileSync(join(reportsDir, 'heldout-exposure.log'), `${report.date}\t${label}\t${report.versions.corpus}\t${results.length} cases\n`);
}

const s = report.summary;
const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
console.log(
  `${label} on ${split}: ${s.cases} cases, ${s.words} words, ${elapsedMs} ms\n` +
    `  correction precision ${pct(s.correction.precision)} (${s.correction.detections - s.correction.falsePositives}/${s.correction.detections})\n` +
    `  recall ${pct(s.correction.recallLenient)} lenient, ${pct(s.correction.recallStrict)} strict (of ${s.correction.expected})\n` +
    `  fix accuracy ${pct(s.correction.fixAccuracy)}; clean-text FPs ${s.cleanText.perThousandWords?.toFixed(2) ?? 'n/a'}/1k words\n` +
    `  forbidden spans touched ${s.forbiddenTouched}; style observations ${s.style.detections}\n` +
    `  report: eval/reports/latest.md`,
);
if (caseErrors.length) {
  console.error(`\n${caseErrors.length} case(s) failed validation:`);
  for (const e of caseErrors) console.error(`  ${e.file}: ${e.problems.join('; ')}`);
  process.exit(1);
}
