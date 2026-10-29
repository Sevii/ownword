#!/usr/bin/env node
// Per-rule evidence for policy decisions (docs/improvement-plan.md §1.1).
// Usage (from frontend/): node ../eval/harness/rules-report.js [--split dev] [--raw]
// For every engine rule: how many findings landed on an annotated likely
// error (hit), on an annotated style or optional span (ok), or on nothing
// (miss), and what classification the engine gave them. --raw runs Harper
// without the app policy, so rules the policy filters still appear.

import { parseArgs } from 'node:util';
import { loadCases, prepareCase } from './cases.js';
import { analyze } from '../../frontend/src/analysis/pipeline.js';
import { createNodeHarperEngine } from '../../frontend/src/analysis/engines/harper-node.js';
import { createRulesEngine } from '../../frontend/src/analysis/rules/index.js';

const { values: args } = parseArgs({
  options: { split: { type: 'string', default: 'dev' }, raw: { type: 'boolean', default: false } },
});
if (args.split === 'heldout' && process.env.HELDOUT !== '1') {
  console.error('Refusing to run held-out cases without HELDOUT=1.');
  process.exit(2);
}

const overlaps = (a, b) => a.blockId === b.blockId && a.from < b.to && b.from < a.to;
const engines = [createNodeHarperEngine({ policy: !args.raw }), createRulesEngine()];
await Promise.all(engines.map((e) => e.setup()));

/** @type {Map<string, { hit: number, ok: number, miss: number, kinds: Set<string>, misses: string[], hits: string[] }>} */
const rules = new Map();
for (const { case: c } of loadCases(args.split)) {
  const prepared = prepareCase(c);
  if (prepared.problems.length) continue;
  const { envelope } = await analyze(prepared.snapshot, { dialect: c.dialect, goals: c.goals ?? {} }, { engines, requestId: `rules-${c.id}` });
  const errors = prepared.expected.filter((e) => e.classification === 'likely-error');
  const soft = [...prepared.expected.filter((e) => e.classification !== 'likely-error'), ...prepared.optional];
  for (const f of envelope.findings) {
    if (!f.anchor) continue;
    const row = rules.get(f.origin.ruleId) ?? { hit: 0, ok: 0, miss: 0, kinds: new Set(), misses: [], hits: [] };
    row.kinds.add(f.classification);
    const block = prepared.snapshot.blocks.find((b) => b.id === f.anchor.blockId);
    const text = block.text.slice(f.anchor.from, f.anchor.to);
    if (errors.some((e) => overlaps(f.anchor, e.anchor))) { row.hit++; row.hits.push(`${c.id}:${text}`); }
    else if (soft.some((e) => overlaps(f.anchor, e.anchor))) row.ok++;
    else { row.miss++; row.misses.push(`${c.id}:${text}`); }
    rules.set(f.origin.ruleId, row);
  }
}

const rows = [...rules.entries()].sort((a, b) => b[1].hit + b[1].miss - (a[1].hit + a[1].miss));
console.log('rule\tclass\thit\tok\tmiss\texamples');
for (const [id, r] of rows) {
  const ex = (r.miss ? r.misses : r.hits).slice(0, 4).join(', ');
  console.log(`${id}\t${[...r.kinds].join('/')}\t${r.hit}\t${r.ok}\t${r.miss}\t${ex}`);
}
