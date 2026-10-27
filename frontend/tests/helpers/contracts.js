import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const CONTRACTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../contracts');

const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const f of readdirSync(join(CONTRACTS_DIR, 'schemas'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(CONTRACTS_DIR, 'schemas', f), 'utf8')));
}

/** @param {'snapshot'|'issue'|'envelope'|'ai-request'|'stream-event'} name */
export function validator(name) {
  const v = ajv.getSchema(`${name}.schema.json`);
  if (!v) throw new Error(`no schema ${name}`);
  return (/** @type {unknown} */ data) => {
    const ok = v(data);
    return { ok, errors: ok ? [] : ajv.errorsText(v.errors) };
  };
}

/** @param {string} name @param {'valid'|'invalid'} kind */
export function fixtures(name, kind) {
  const dir = join(CONTRACTS_DIR, 'fixtures', name, kind);
  return readdirSync(dir).map((f) => ({ file: f, data: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}
