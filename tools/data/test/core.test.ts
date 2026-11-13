import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';

const core = new URL('../../../src/core/', import.meta.url);

// The tools import src/core as it is, so a core file that only a bundler could load (an extensionless import, or a
// type imported as a value) would break them. Plain Node loading every file catches that.
test('plain Node imports every file in src/core', async () => {
  const files = readdirSync(core).filter((f) => f.endsWith('.ts'));

  assert.ok(files.length >= 4, `only ${files.length} files in src/core`);
  for (const f of files) {
    try {
      await import(new URL(f, core).href);
    } catch (e) {
      assert.fail(`src/core/${f} doesn't load under plain Node: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
});
