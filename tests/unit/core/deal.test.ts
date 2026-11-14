import { describe, expect, it } from 'vitest';
import { inDealBox } from '../../../src/core/abs.ts';
import { dealableCards, dealTen, pilesOf, tenProblems, type Card, type Piles } from '../../../src/core/deal.ts';
import { decodeTables } from '../../../src/core/decode.ts';
import { crossing, flightTime } from '../../../src/core/kinematics.ts';
import { mulberry32, type Rand } from '../../../src/core/rng.ts';
import { MAX_FLIGHT_S } from '../../../src/core/rules.ts';
import { SHARD_FORMAT } from '../../../src/core/schema.ts';
import { asFile, pitchCells, shardDoc, trajThrough } from './fixtures.ts';

const card = (seq: number, absMarginIn: number, challenged = false): Card => ({ id: `p${seq}`, seq, absMarginIn, challenged });

describe('dealing a round of ten', () => {
  const piles = pilesOf([card(1, 7), card(2, 0.3, true), ...Array.from({ length: 7 }, (_, k) => card(10 + k, 1)), card(30, 3)]);

  it('deals a calibrator, then eight close calls and one more within 4.5 in, in played order', () => {
    const ten = dealTen(piles, mulberry32(3));

    expect(ten?.[0]?.id).toBe('p1');
    expect(tenProblems(ten ?? [])).toEqual([]);
  });

  it('gives null when a pile runs short, such as no challenged close call', () => {
    expect(dealTen(pilesOf([card(1, 7), ...Array.from({ length: 9 }, (_, k) => card(10 + k, 1)), card(30, 3)]), mulberry32(3))).toBeNull();
  });

  it('names what breaks the rules, such as a ten out of played order', () => {
    const ten = dealTen(piles, mulberry32(3)) ?? [];

    expect(tenProblems([ten[0] as Card, ...ten.slice(1).reverse()])).toEqual(['not in played order']);
  });

  it("throws rather than deal a ten that breaks the rules from piles pilesOf didn't make", () => {
    const wrong: Piles<Card> = { ...piles, near: [card(40, 5)] };

    expect(() => dealTen(wrong, mulberry32(3))).toThrow('breaks the rules of the round: 0 calls between 1.5 and 4.5 in');
  });
});

describe('dealing from 1,000 seeded random sets of cards', () => {
  // Close calls are common, as in a shard, and challenged ones rare enough that some sets have none.
  const margin = (r: Rand): number => {
    const u = r();

    return u < 0.5 ? r() * 1.5 : u < 0.65 ? 1.5 + r() * 3 : u < 0.75 ? 4.5 + r() * 1.5 : 6 + r() * 6;
  };

  it('deals ten distinct cards from the set that meet the rules, or null exactly when a pile is short', () => {
    let dealt = 0;

    for (let seed = 1; seed <= 1000; seed++) {
      const r = mulberry32(seed);
      const cards = Array.from({ length: 6 + Math.floor(r() * 40) }, (_, i): Card => ({
        id: `${seed}-${i}`,
        seq: Math.floor(r() * 1e6),
        absMarginIn: margin(r),
        challenged: r() < 0.08,
      }));
      const piles = pilesOf(cards);
      const ten = dealTen(piles, mulberry32(seed + 1e6));
      const canDeal = piles.closeChallenged.length > 0 && piles.close.length >= 8 && piles.near.length > 0 && piles.calibrators.length > 0;

      expect(ten !== null, `seed ${seed}`).toBe(canDeal);
      if (!ten) continue;
      dealt++;
      expect(tenProblems(ten), `seed ${seed}`).toEqual([]);
      expect(new Set(ten).size).toBe(10);
      expect(ten.every((c) => cards.includes(c))).toBe(true);
    }
    // Both outcomes come up often enough to mean something.
    expect(dealt).toBeGreaterThan(200);
    expect(dealt).toBeLessThan(900);
  });
});

describe('only rows whose stored dealable flag is set reach a deck', () => {
  // Each held-back row crosses mid-plate inside the deal box, so a rule that checked only the box would deal all three.
  const rows = [
    pitchCells({ atBat: 1 }),
    // Kept in the pool for its challenge, but without an extension it can't be drawn (like 822806-17-2).
    pitchCells({ atBat: 2, extension: null, dealable: 0, challenge: [11, 'AWY', 'B', 0] }),
    // Full data, but too slow: an eephus takes more than 0.6 s to reach the plate.
    pitchCells({ atBat: 3, ...trajThrough(0.4, 2.2, 80), dealable: 0 }),
    // Quick, in the box and fully drawable, yet held back (an uncertain batter, say): the flag decides, not the rules.
    pitchCells({ atBat: 4, dealable: 0 }),
    pitchCells({ atBat: 5, marginIn: -7 }),
  ];
  const { pitches } = decodeTables(asFile(shardDoc(rows)), SHARD_FORMAT);

  it('leaves them out, and gives the rest their place in the file as played order', () => {
    const cards = dealableCards(pitches);

    expect(cards.map((c) => [c.id, c.seq, c.absMarginIn])).toEqual([
      ['900001-1-1', 0, 0.8],
      ['900001-5-1', 4, 7],
    ]);
    expect(pitches.filter((p) => !p.dealable).map((p) => inDealBox(crossing(p.traj)))).toEqual([true, true, true]);
    expect(flightTime(pitches[2]?.traj ?? trajThrough(0, 0), 6.5)).toBeGreaterThan(MAX_FLIGHT_S);
  });
});
