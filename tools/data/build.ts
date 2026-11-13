// npm run data:build: turns the cached MLB Stats API responses into public/data/season-2026 and the build report.
// It reads only the cache (run data:fetch first) and is deterministic, so a rebuild from the same cache is identical.
// It keeps the manifest's daily block as it is: the month files are data:daily's.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ManifestDoc } from '../../src/core/schema.ts';
import { cacheDir, openCache } from './lib/cache.ts';
import { loadInputs } from './lib/inputs.ts';
import { buildDataset, OUT_DIR } from './lib/pipeline.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = openCache(cacheDir());
const inputs = loadInputs(cache, (line) => console.log(line));
const manifestFile = join(root, OUT_DIR, 'manifest.json');
const before = existsSync(manifestFile) ? (JSON.parse(readFileSync(manifestFile, 'utf8')) as Partial<ManifestDoc>) : null;

if (!inputs) {
  console.error('The MLB Stats API cache is empty. Run npm run data:fetch first.');
  process.exit(1);
}

console.log(`building from ${inputs.people.size} cached players and the cached 2026 schedule`);

const started = Date.now();
const { files, summary, sizes, build } = buildDataset(inputs, before?.daily);
const shardDir = join(root, OUT_DIR, 'shards');

for (const [rel, text] of files) {
  const file = join(root, rel);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
for (const name of readdirSync(shardDir)) {
  if (!files.has(`${OUT_DIR}/shards/${name}`)) rmSync(join(shardDir, name));
}

console.log(summary.map((s) => `  ${s}`).join('\n'));
console.log(
  `  per shard (KB raw / gzipped): ${sizes.shardBytes
    .map((b, i) => `${(b / 1000).toFixed(0)}/${((sizes.shardGzipBytes[i] ?? 0) / 1000).toFixed(0)}`)
    .join(' ')}`,
);
console.log(`wrote ${files.size} files in ${((Date.now() - started) / 1000).toFixed(0)} s`);
if (before?.daily && before.build !== build) {
  console.log(`The build id changed from ${before.build ?? 'none'} to ${build}: run npm run data:daily to refresh the month files.`);
}
