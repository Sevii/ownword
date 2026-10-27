#!/usr/bin/env node
// Validate corpus cases without running any engine, so authors and labelers
// are not biased by engine output. Usage: node eval/harness/validate.js [dev|heldout]

import { loadCases, prepareCase } from './cases.js';

const splits = process.argv[2] ? [process.argv[2]] : ['dev', 'heldout'];
let bad = 0;
const ids = new Map();
for (const split of splits) {
  const cases = loadCases(/** @type {'dev'|'heldout'} */ (split));
  const counts = { cases: cases.length, clean: 0, expected: 0, categories: {} };
  for (const { file, case: c } of cases) {
    if (ids.has(c.id)) {
      console.error(`${file}: duplicate id ${c.id} (also ${ids.get(c.id)})`);
      bad++;
    }
    ids.set(c.id, file);
    const p = prepareCase(c);
    if (p.problems.length) {
      bad++;
      console.error(`${file}: ${p.problems.join('; ')}`);
      continue;
    }
    if (c.clean) counts.clean++;
    for (const e of c.expected) {
      counts.expected++;
      counts.categories[e.category] = (counts.categories[e.category] ?? 0) + 1;
    }
  }
  console.log(`${split}: ${JSON.stringify(counts)}`);
}
if (bad) {
  console.error(`${bad} invalid case(s)`);
  process.exit(1);
}
