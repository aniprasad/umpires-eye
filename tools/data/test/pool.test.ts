import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dealTen, deckOf, tenProblems, type Card } from '../lib/deal.ts';
import type { Judged } from '../lib/judge.ts';
import { CALIBRATOR_SHARE, makeShards, selectPool, stratumOf } from '../lib/pool.ts';
import { mulberry32 } from '../lib/rng.ts';
import { judged } from './fixtures.ts';

function season(n: number): Judged[] {
  const rand = mulberry32(7);

  return Array.from({ length: n }, (_, seq) => {
    const r = rand();
    const marginIn = (rand() < 0.5 ? -1 : 1) * (r < 0.3 ? 1.5 * rand() : r < 0.5 ? 1.5 + 3 * rand() : r < 0.6 ? 4.5 + 1.5 * rand() : 6 + 4 * rand());

    return judged({ seq, marginIn, bats: rand() < 0.4 ? 'L' : 'R', challenged: rand() < 0.04 });
  });
}

describe('selectPool', () => {
  test('takes every challenge and every dealable call within 4.5 in, and samples clear calls', () => {
    const all = [
      judged({ seq: 0, marginIn: 0.4 }),
      judged({ seq: 1, marginIn: -3 }),
      judged({ seq: 2, marginIn: 5 }),
      judged({ seq: 3, marginIn: 0.2, dealable: false }),
      judged({ seq: 4, marginIn: -0.3, renderable: false }),
      judged({ seq: 5, marginIn: -20, dealable: false, challenged: true }),
      ...Array.from({ length: 30 }, (_, k) => judged({ seq: 10 + k, marginIn: k % 2 ? 1 : -1 })),
      ...Array.from({ length: 50 }, (_, k) => judged({ seq: 100 + k, marginIn: 8 })),
    ];
    const pool = selectPool(all, 'seed');
    const bySeq = new Map(pool.entries.map((e) => [e.j.seq, e]));

    assert.equal(bySeq.get(0)?.bucket, 'close');
    assert.equal(bySeq.get(1)?.bucket, 'near');
    assert.equal(bySeq.has(2), false);
    assert.equal(bySeq.has(3), false);
    assert.equal(bySeq.has(4), false);
    assert.deepEqual([bySeq.get(5)?.bucket, bySeq.get(5)?.dealable], ['challenge', false]);
    assert.deepEqual(pool.undrawable, { close: 1, near: 0 });
    assert.equal(pool.entries.filter((e) => e.bucket === 'calibrator').length, Math.round(32 * CALIBRATOR_SHARE));
    assert.deepEqual(selectPool(all, 'seed'), pool);
  });
});

describe('makeShards', () => {
  const pool = selectPool(season(6000), 'seed').entries;
  const shards = makeShards(pool, 7, 'seed');

  test('puts every pool pitch in exactly one shard, in played order', () => {
    const seen = shards.flat().map((e) => e.j.seq);

    assert.equal(seen.length, pool.length);
    assert.equal(new Set(seen).size, pool.length);
    for (const s of shards) assert.ok(s.every((e, k) => k === 0 || (s[k - 1]?.j.seq ?? -1) < e.j.seq));
  });

  test('balances every stratum across shards to within one', () => {
    const sizes = shards.map((s) => s.length);

    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    for (const key of new Set(pool.map(stratumOf))) {
      const counts = shards.map((s) => s.filter((e) => stratumOf(e) === key).length);

      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${key}: ${counts.join(',')}`);
    }
  });

  test('lets every shard deal a full ten', () => {
    for (const s of shards) {
      const cards = s.filter((e) => e.dealable).map((e) => ({ id: e.j.p.id, seq: e.j.seq, absMarginIn: Math.abs(e.j.marginIn), challenged: !!e.j.p.challenge }));
      const deck = deckOf(cards);
      const rand = mulberry32(1);

      for (let k = 0; k < 50; k++) assert.deepEqual(tenProblems(dealTen(deck, rand) ?? []), []);
    }
  });

  test('is deterministic', () => {
    assert.deepEqual(
      makeShards(pool, 7, 'seed').map((s) => s.map((e) => e.j.seq)),
      shards.map((s) => s.map((e) => e.j.seq)),
    );
  });
});

describe('dealing', () => {
  const card = (seq: number, absMarginIn: number, challenged = false): Card => ({ id: `p${seq}`, seq, absMarginIn, challenged });
  const deck = deckOf([
    card(1, 7),
    card(2, 0.3, true),
    ...Array.from({ length: 7 }, (_, k) => card(10 + k, 1)),
    card(30, 3),
  ]);

  test('deals a calibrator, then eight close calls and one more within 4.5 in, in played order', () => {
    const ten = dealTen(deck, mulberry32(3));

    assert.ok(ten);
    assert.equal(ten[0]?.id, 'p1');
    assert.deepEqual(tenProblems(ten), []);
  });

  test('refuses a deck without a challenged close call', () => {
    assert.equal(dealTen(deckOf([card(1, 7), ...Array.from({ length: 9 }, (_, k) => card(10 + k, 1)), card(30, 3)]), mulberry32(3)), null);
  });

  test('tenProblems catches a ten dealt out of order', () => {
    const ten = dealTen(deck, mulberry32(3)) ?? [];

    assert.deepEqual(tenProblems([ten[0] as Card, ...ten.slice(1).reverse()]), ['not in played order']);
  });
});
