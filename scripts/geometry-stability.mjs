// Report whether the recorded X/Y readback (GetPosition, recorded only since
// 2026-10-14) meets the promotion criteria in docs/range-recipes.md.
// Reads experiment storage (runs/); it is not part of the portable gate.
// Usage: node scripts/geometry-stability.mjs [storage-directory]
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
const CRITERIA = { samples: 200, attributeKinds: 6, repeatedRecipes: 3, days: 2, pagesBeyondFirst: true };
const samples = [];
for (const run of await fs.readdir(path.join(root, 'runs')).catch(() => [])) {
  const dir = path.join(root, 'runs', run, 'samples');
  for (const id of await fs.readdir(dir).catch(() => [])) {
    let manifest; try { manifest = JSON.parse(await fs.readFile(path.join(dir, id, 'manifest.json'), 'utf8')); } catch { continue; }
    const proof = manifest.verification?.rangeProof;
    if (!proof?.geometry?.['before-save'] || !proof.geometry.reopened) continue;
    const before = proof.geometry['before-save'], after = proof.geometry.reopened;
    const characters = Object.keys(before);
    const unstable = characters.filter(i => JSON.stringify(before[i]) !== JSON.stringify(after[i]));
    const recipe = JSON.parse(await fs.readFile(path.join(root, 'runs', run, 'run.json'), 'utf8')).experiment.name;
    const kinds = [...new Set((manifest.requested?.operations ?? []).map(op => op.attribute))];
    const pages = [...new Set(Object.values(before).map(g => g['ページ番号']))];
    samples.push({ run, id, day: run.slice(0, 10), pages, recipe, characters: characters.length, unstable: unstable.length, kinds, status: manifest.status, before });
  }
}
// Determinism: the same recipe and sample id produce the same before-save geometry in different runs.
const groups = new Map();
for (const s of samples) { const key = `${s.recipe}/${s.id}`; groups.set(key, [...(groups.get(key) ?? []), s]); }
const repeated = [...groups.entries()].filter(([, list]) => list.length >= 2);
const nondeterministic = repeated.filter(([, list]) => list.some(s => JSON.stringify(s.before) !== JSON.stringify(list[0].before))).map(([key]) => key);
const kinds = [...new Set(samples.flatMap(s => s.kinds))];
const report = {
  criteria: CRITERIA,
  samples: samples.length, characters: samples.reduce((n, s) => n + s.characters, 0),
  reopenUnstableSamples: samples.filter(s => s.unstable).map(s => `${s.run}/${s.id}`),
  attributeKinds: kinds,
  repeatedRecipeSamples: repeated.length, nondeterministic,
  days: [...new Set(samples.map(s => s.day))].sort(),
  pagesSeen: [...new Set(samples.flatMap(s => s.pages))].sort(),
};
report.ready = report.samples >= CRITERIA.samples && report.reopenUnstableSamples.length === 0 && kinds.length >= CRITERIA.attributeKinds
  && repeated.length >= CRITERIA.repeatedRecipes && nondeterministic.length === 0
  && report.days.length >= CRITERIA.days && report.pagesSeen.some(page => page !== '1');
console.log(JSON.stringify(report, null, 2));
