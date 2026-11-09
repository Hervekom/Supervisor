import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'node:fs';
import path from 'node:path';
import { auditEntry, ORDER, type Software } from './software';

const DIR = path.join(process.cwd(), 'data/software');
const SCHEMA = path.join(process.cwd(), 'data/schema/software.schema.json');

export function validateCatalogue(entries: { file: string; data: unknown }[]) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const check = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA, 'utf8')));
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const { file, data } of entries) {
    if (!check(data)) {
      errors.push(...(check.errors ?? []).map((x) => `${file}: ${x.instancePath || '/'} ${x.message}`));
      continue;
    }
    const e = data as Software;
    if (`${e.id}.json` !== file) errors.push(`${file}: id ${e.id} does not match the file name`);
    if (ids.has(e.id)) errors.push(`${file}: duplicate id ${e.id}`);
    ids.add(e.id);
  }
  const valid = entries.map((x) => x.data as Software).filter((e) => e && typeof e === 'object' && ids.has(e.id));
  for (const e of valid) errors.push(...auditEntry(e, ids));
  return { ok: errors.length === 0, errors, entries: valid };
}

/** Reads and validates every entry. A bad entry stops the build instead of reaching students. */
export function loadCatalogue(): Software[] {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  const r = validateCatalogue(files.map((file) => ({ file, data: JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8')) })));
  if (!r.ok) throw new Error(`The software catalogue is invalid:\n${r.errors.join('\n')}`);
  return r.entries.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}
