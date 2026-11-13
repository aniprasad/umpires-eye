import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pct, umpVsAbs } from '../lib/stats.ts';
import { judged } from './fixtures.ts';

test('percentages keep two decimals, so one miss in 10,749 is not 100', () => {
  assert.equal(pct(10748, 10749), 99.99);
  assert.equal(pct(0, 0), 0);
});

test('umpVsAbs bands by the stored margin, as the pool and the app do', () => {
  // 1.504 in is stored as 1.50, so it is a close call; 1.506 is stored as 1.51 and is not.
  const u = umpVsAbs([judged({ seq: 0, marginIn: 1.504 }), judged({ seq: 1, marginIn: -1.506 })]);

  assert.deepEqual([u.close.total, u.near.total], [1, 2]);
});
