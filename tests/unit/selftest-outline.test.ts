import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { fromPoolFile, type PoolFile } from '../../src/data/ws2026';
import { CHECKS, selfTestContext } from '../../src/selftest/checks';

// sphereOutline returns null when it can't outline a sphere; here it never can.
vi.mock(import('../../src/math/geometry'), async (importOriginal) => ({ ...(await importOriginal()), sphereOutline: () => null }));

it("fails the camera check when the catcher's helmet has no outline, rather than calling it clear", () => {
  const file = JSON.parse(readFileSync(new URL('../../public/data/ws-2026/pool.json', import.meta.url), 'utf8')) as PoolFile;
  const camera = CHECKS.find((c) => c.id === 'camera');

  expect(camera?.run(selfTestContext(fromPoolFile(file))).failures).toContainEqual(expect.stringMatching(/^catcher over zone /));
});
