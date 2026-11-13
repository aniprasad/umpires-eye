import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crossing } from '../lib/physics.ts';
import { trajThrough } from './fixtures.ts';

// The math itself is src/core's, tested in tests/unit/core.

const close = (a: number, b: number, tol: number): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('the fixture trajectory crosses mid-plate where it is asked to', () => {
  const mid = crossing(trajThrough(0.75, 1.7));

  close(mid.x, 0.75, 1e-12);
  close(mid.z, 1.7, 1e-12);
});
