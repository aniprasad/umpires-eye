// npm run data:build: turns the cached MLB Stats API responses into public/data/season-2026 and the build report.
// It reads only the cache (run data:fetch first) and is deterministic, so a rebuild from the same cache is identical.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDir, openCache } from './lib/cache.ts';
import { loadInputs } from './lib/inputs.ts';
import { buildDataset, OUT_DIR } from './lib/pipeline.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cache = openCache(cacheDir());
const inputs = loadInputs(cache, (line) => console.log(line));

if (!inputs) {
  console.error('The MLB Stats API cache is empty. Run npm run data:fetch first.');
  process.exit(1);
}

console.log(`building from ${inputs.people.size} cached players and the cached 2026 schedule`);

const started = Date.now();
const { files, summary, sizes } = buildDataset(inputs);
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
