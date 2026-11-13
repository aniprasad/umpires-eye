import { describe, expect, it } from 'vitest';
import { varietyProblems, type VarietyCard } from '../../../src/core/daily.ts';

// A ten that passes: a calibrator, eight close calls (two challenged) and a near call, from ten games, with five batters
// on each side, three pitch families, and one two-strike count among the nine.
function ten(change: (k: number) => Partial<VarietyCard> = () => ({})): VarietyCard[] {
  return Array.from({ length: 10 }, (_, k) => ({
    id: `${900000 + k}-1-1`,
    seq: k,
    absMarginIn: k === 0 ? 8 : k === 9 ? 3 : 0.5,
    challenged: k === 1 || k === 2,
    gamePk: 900000 + k,
    bats: k % 2 ? 'L' : 'R',
    family: k % 3 === 0 ? 'fastball' : k % 3 === 1 ? 'breaking' : 'offspeed',
    balls: 1,
    strikes: k === 4 ? 2 : 0,
    ...change(k),
  }));
}

const rulesBroken = (cards: readonly VarietyCard[]): string[] => varietyProblems(cards).map((p) => p.split(':')[0] ?? p);

describe("Today's Ten's variety rules", () => {
  it('pass a ten that keeps them all', () => {
    expect(varietyProblems(ten())).toEqual([]);
  });

  it('allow one pitch per game, the calibrator included', () => {
    expect(rulesBroken(ten((k) => (k === 0 ? { gamePk: 900005 } : {})))).toEqual(['one pitch per game']);
  });

  it('want three batters on each side, the calibrator included', () => {
    // Two left-handers fall short, and three are enough.
    expect(rulesBroken(ten((k) => (k < 7 ? { bats: 'R' } : {})))).toEqual(['batter sides']);
    expect(rulesBroken(ten((k) => (k < 5 ? { bats: 'R' } : {})))).toEqual([]);
  });

  it('want two pitch families among the nine, and not eight fastballs among the close calls', () => {
    expect(rulesBroken(ten((k) => ({ family: k ? 'breaking' : 'fastball' })))).toEqual(['pitch families']);
    expect(rulesBroken(ten((k) => ({ family: k >= 1 && k <= 8 ? 'fastball' : 'breaking' })))).toEqual(['pitch families']);
    expect(rulesBroken(ten((k) => ({ family: k >= 1 && k <= 7 ? 'fastball' : 'breaking' })))).toEqual([]);
  });

  it('want two strikes or three balls among the nine, not just on the calibrator', () => {
    expect(rulesBroken(ten((k) => ({ strikes: 0, balls: k === 0 ? 3 : 1 })))).toEqual(['two strikes or three balls']);
    expect(rulesBroken(ten((k) => ({ strikes: 0, balls: k === 9 ? 3 : 1 })))).toEqual([]);
  });

  it('allow at most three ABS-challenged close calls, not counting the near call', () => {
    expect(rulesBroken(ten((k) => ({ challenged: k >= 1 && k <= 4 })))).toEqual(['ABS challenges']);
    expect(rulesBroken(ten((k) => ({ challenged: (k >= 1 && k <= 3) || k === 9 })))).toEqual([]);
  });
});
