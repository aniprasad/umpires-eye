import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const core = fileURLToPath(new URL('../../../src/core/', import.meta.url));

// The tools import src/core as it is, so a core file that only a bundler could load (an extensionless import, or a
// type imported as a value) would break them. Plain Node loading every file catches that.
test('plain Node imports every file in src/core, in subfolders too', async () => {
  const files = readdirSync(core, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replaceAll('\\', '/'));

  assert.ok(files.length >= 4, `only ${files.length} files in src/core`);
  for (const f of files) {
    try {
      await import(pathToFileURL(join(core, f)).href);
    } catch (e) {
      assert.fail(`src/core/${f} doesn't load under plain Node: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
});
