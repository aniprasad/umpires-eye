import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dealTen, deckOf, tenProblems, type Card } from '../lib/deal.ts';
import { judge, type Judged } from '../lib/judge.ts';
import { makeShards, selectPool, spreadSample, stratumOf, type Pool } from '../lib/pool.ts';
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
  const all = [
    judged({ seq: 0, marginIn: -3, challenged: true }),
    judged({ seq: 1, marginIn: 5 }),
    judged({ seq: 2, marginIn: 0.2, dealable: false }),
    judged({ seq: 3, marginIn: -0.3, showable: false }),
    judged({ seq: 4, marginIn: -20, dealable: false, challenged: true }),
    ...Array.from({ length: 40 }, (_, k) => judged({ seq: 10 + k, marginIn: k % 2 ? 1 : -1 })),
    ...Array.from({ length: 30 }, (_, k) => judged({ seq: 100 + k, marginIn: 3 })),
    ...Array.from({ length: 50 }, (_, k) => judged({ seq: 200 + k, marginIn: 8 })),
  ];
  const count = (pool: Pool, bucket: string): number => pool.entries.filter((e) => e.bucket === bucket).length;

  test('keeps every challenge and every dealable close call, and samples near calls and calibrators per close call', () => {
    const pool = selectPool(all, 'seed');
    const bySeq = new Map(pool.entries.map((e) => [e.j.seq, e]));

    assert.deepEqual(pool.season, { close: 40, near: 31, clear: 50 });
    assert.equal(count(pool, 'close'), 40);
    // Five near calls in all (40 / 8), and the challenged one is already in.
    assert.equal(count(pool, 'near'), 4);
    assert.equal(count(pool, 'calibrator'), 5);
    assert.deepEqual([bySeq.get(0)?.bucket, bySeq.get(0)?.dealable], ['challenge', true]);
    assert.deepEqual([bySeq.get(4)?.bucket, bySeq.get(4)?.dealable], ['challenge', false]);
    assert.deepEqual([1, 2, 3].map((seq) => bySeq.has(seq)), [false, false, false]);
    assert.deepEqual(pool.notShowable, { close: 1, near: 0 });
    assert.deepEqual(selectPool(all, 'seed'), pool);
  });

  test('takes the sampling rates as a parameter', () => {
    const pool = selectPool(all, 'seed', { near: 1 / 2, calibrator: 1 / 4 });

    assert.deepEqual([count(pool, 'close'), count(pool, 'near'), count(pool, 'calibrator')], [40, 19, 10]);
  });

  test('leaves out a pitch whose count before it is impossible', () => {
    const fine = judge(judged({ seq: 0, marginIn: 0.4 }).p, 0);
    const broken = judge({ ...fine.p, id: '900001-1-1', atBat: 1, balls: 2, strikes: 3 }, 1);

    assert.deepEqual([fine.showable, broken.showable], [true, false]);
    assert.deepEqual(
      selectPool([fine, broken], 'seed').entries.map((e) => e.j.seq),
      [0],
    );
  });
});

describe('spreadSample', () => {
  const rand = mulberry32(11);
  const types = ['FF', 'SL', 'CH', 'CU'];
  const n = 2000;
  const candidates = Array.from({ length: n }, (_, seq) => {
    const r = rand();

    return judged({ seq, marginIn: 3, pitchType: r < 0.5 ? 'FF' : r < 0.75 ? 'SL' : r < 0.9 ? 'CH' : 'CU', team: 1 + Math.floor(rand() * 3) });
  });
  const want = 250;
  const picked = spreadSample(candidates, want, 'seed');
  const within1 = (have: number, of: number): boolean => Math.abs(have - (of * want) / n) < 1;

  test('keeps every pitch type, and every team within it, to its share within one pitch', () => {
    assert.equal(new Set(picked.map((j) => j.seq)).size, want);
    for (const type of types) {
      const all = candidates.filter((j) => j.p.pitchType === type);
      const got = picked.filter((j) => j.p.pitchType === type);

      assert.ok(within1(got.length, all.length), `${type}: ${got.length} of ${all.length}`);
      for (const team of [1, 2, 3]) {
        const t = (j: Judged): boolean => j.p.pitchingTeamId === team;

        assert.ok(within1(got.filter(t).length, all.filter(t).length), `${type} team ${team}`);
      }
    }
  });

  test('spreads the picks through the season', () => {
    for (let q = 0; q < 4; q++) {
      const inQuarter = picked.filter((j) => j.seq >= (q * n) / 4 && j.seq < ((q + 1) * n) / 4).length;

      assert.ok(inQuarter >= want * 0.2 && inQuarter <= want * 0.3, `quarter ${q}: ${inQuarter}`);
    }
  });

  test('is deterministic for a seed and changes with it', () => {
    const seqs = (list: Judged[]): number[] => list.map((j) => j.seq).sort((a, b) => a - b);

    assert.deepEqual(seqs(spreadSample(candidates, want, 'seed')), seqs(picked));
    assert.notDeepEqual(seqs(spreadSample(candidates, want, 'other')), seqs(picked));
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
