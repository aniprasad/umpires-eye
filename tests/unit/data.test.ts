import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromPoolFile, WS_LABEL, WS_TODAY_IDS } from '../../src/data/ws2026';
import { fmtHeight, marginPhrase, resultText, toughest } from '../../src/math/words';
import { judged } from '../../src/math/flow';
import { prep } from '../../src/math/kinematics';
import { PLATE_HALF } from '../../src/math/constants';
import { synthPitch } from './fixtures';

const game = { gamePk: 1, gameNumber: 1, away: 'AWY', home: 'HOM' };

describe('the World Series source', () => {
  it("returns Today's Ten in play order from the pool", () => {
    const pitches = [...WS_TODAY_IDS].reverse().map((id) => synthPitch({ id }));
    const data = fromPoolFile({ games: [game], pitches });

    expect(data.label).toBe(WS_LABEL);
    expect(data.today.map((p) => p.id)).toEqual([...WS_TODAY_IDS]);
    expect(data.pitches).toHaveLength(10);
  });

  it("refuses a pool without one of Today's Ten, naming it", () => {
    const pitches = WS_TODAY_IDS.slice(1).map((id) => synthPitch({ id }));

    expect(() => fromPoolFile({ games: [game], pitches })).toThrow(WS_TODAY_IDS[0]);
  });
});

describe('words on the reveal and the card', () => {
  it('writes heights the way a matchup card does', () => {
    expect(fmtHeight(6.0833)).toBe('6′1″');
    expect(fmtHeight(5.9999)).toBe('6′0″');
  });

  it('names the edge a close strike caught, and which way a ball missed', () => {
    const z = 3.2 + 0.05;
    const strike = prep(synthPitch({ traj: { x0: 0, y0: 50, z0: z, vX0: 0, vY0: -130, vZ0: 0, aX: 0, aY: 0, aZ: 0 } }));
    const ball = prep(synthPitch({ traj: { x0: PLATE_HALF + 0.5, y0: 50, z0: 2.4, vX0: 0, vY0: -130, vZ0: 0, aX: 0, aY: 0, aZ: 0 } }));

    expect(marginPhrase(strike)).toMatch(/^Caught the top of the zone by \d\.\d\u00a0in$/);
    expect(marginPhrase(ball)).toMatch(/^Missed away by \d\.\d\u00a0in$/);
  });

  it('says nothing got by you on a perfect round', () => {
    const P = prep(synthPitch());

    expect(toughest([judged(P, 'strike')])).toBe('Nothing got by you');
    expect(toughest([judged(P, 'ball')])).toMatch(/^Four-Seam Fastball, /);
  });

  it('ends the copied result with the data credit AGENTS.md requires', () => {
    const rules = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
    const credit = /Credit the data: "([^"]+)"/.exec(rules)?.[1];
    const set = [prep(synthPitch())];
    const text = resultText({ label: WS_LABEL, roundLabel: "Today's Ten", set, results: [judged(set[0], 'strike')] });

    expect(credit).toMatch(/MLB Stats API/);
    expect(text.split('\n').at(-1)).toContain(credit);
  });
});
