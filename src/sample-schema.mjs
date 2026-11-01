import { readFileSync } from 'node:fs';
import { assertSupportedSchema } from './schema-validation.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const SAMPLE_SCHEMA = freeze(JSON.parse(readFileSync(new URL('../schemas/sample-catalog.schema.json', import.meta.url), 'utf8')));
assertSupportedSchema(SAMPLE_SCHEMA);
export const APPLICATION_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
