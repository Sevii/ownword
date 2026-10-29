#!/usr/bin/env node
// CI gate (docs/improvement-plan.md §1.4): compare reports/latest.json with
// thresholds.json and fail when correction quality regresses. Run after
// `npm run eval` from frontend/: node ../eval/harness/gate.js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVAL_DIR } from './cases.js';

const report = JSON.parse(readFileSync(join(EVAL_DIR, 'reports', 'latest.json'), 'utf8'));
const thresholds = JSON.parse(readFileSync(join(EVAL_DIR, 'harness', 'thresholds.json'), 'utf8'));
const t = thresholds[report.split];
if (!t) {
  console.log(`No thresholds for split ${report.split}; nothing to gate.`);
  process.exit(0);
}
const s = report.summary;
const checks = [
  ['correction precision', s.correction.precision, t.minPrecision, '>='],
  ['lenient recall', s.correction.recallLenient, t.minRecallLenient, '>='],
  ['clean-text false positives per 1k words', s.cleanText.perThousandWords, t.maxCleanFalsePositivesPer1k, '<='],
  ['forbidden spans touched', s.forbiddenTouched, t.maxForbiddenTouched, '<='],
];
let failed = false;
for (const [name, value, limit, op] of checks) {
  if (value === null || value === undefined || limit === undefined) continue;
  const ok = op === '>=' ? value >= limit : value <= limit;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${Number(value).toFixed(3)} ${op} ${limit}`);
  if (!ok) failed = true;
}
if (report.caseErrors?.length) {
  console.log(`FAIL ${report.caseErrors.length} case(s) failed validation`);
  failed = true;
}
process.exit(failed ? 1 : 0);
