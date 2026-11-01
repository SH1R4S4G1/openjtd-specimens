// Evidence integrity gate. Unlike `npm run check`, this requires the experiment
// storage (runs/, catalogs/, observations/, tmp/, output/) referenced by the docs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEvidence } from '../src/evidence-references.mjs';

// --storage may be repeated (ICHITARO_EXPERIMENT_STORAGE may list directories
// separated by the path delimiter, ; on Windows). The first is the experiment
// storage; the others are looked up in order for links and runs the first does
// not hold (for example another worktree whose runs/ holds runs the
// documents cite).
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && arg !== '--storage')) {
  console.error('Usage: node scripts/check-evidence.mjs [--storage <experiment-storage-directory>]...');
  process.exit(2);
}
const listed = args.length ? args.filter((_, i) => i % 2 === 1) : (process.env.ICHITARO_EXPERIMENT_STORAGE?.split(path.delimiter).filter(Boolean) ?? []);
const [storage, ...additionalStorages] = (listed.length ? listed : [root]).map(directory => path.resolve(directory));
const result = await checkEvidence({ root, storage, additionalStorages });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
