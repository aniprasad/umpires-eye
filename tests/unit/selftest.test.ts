import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromPoolFile, WS_TODAY_IDS, type PoolFile } from '../../src/data/ws2026';
import { CHECKS, runSelfTest, selfTestContext, type CheckResult } from '../../src/selftest/checks';

const file = JSON.parse(readFileSync(new URL('../../public/data/ws-2026/pool.json', import.meta.url), 'utf8')) as PoolFile;

describe('the shipped pool', () => {
  it("holds every one of Today's Ten", () => {
    const ids = new Set(file.pitches.map((p) => p.id));

    expect(WS_TODAY_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });
});

const ctx = selfTestContext(fromPoolFile(file));
const cache = new Map<string, CheckResult>();

function run(id: string): CheckResult {
  const hit = cache.get(id);

  if (hit) return hit;
  const check = CHECKS.find((c) => c.id === id);

  if (!check) throw new Error(`No check ${id}`);
  const r = check.run(ctx);

  cache.set(id, r);

  return r;
}

describe("the mockup's self-test guarantees", () => {
  for (const c of CHECKS) {
    it(c.name, () => {
      expect(run(c.id).failures).toEqual([]);
    });
  }

  it('prints PASS as the page does', () => {
    expect(runSelfTest(ctx).lines.at(-1)).toBe('RESULT: PASS');
  });
});

// The figures the mockup's notes quote, compared the way the mockup printed them (toFixed). They pin the port to the
// mockup's math, seeds and random draws.
describe('the figures recorded for the mockup', () => {
  it("Today's Ten: calibrator first, 8 close calls, the real ump 7/10 and 8/10 after ABS", () => {
    const s = run('makeup').stats;

    expect(s.calibratorIn).toBeGreaterThanOrEqual(6);
    expect(s.close).toBe(8);
    expect(s.umpRight).toBe(7);
    expect(s.umpAfter).toBe(8);
    expect(s.challenged).toBeGreaterThanOrEqual(1);
  });

  it('ABS truth: 742/742 pitches and 29/29 challenges', () => {
    expect(run('pool').stats.pitches).toBe(742);
    expect(run('pool').stats.truthMismatches).toBe(0);
    expect(run('pool').stats.maxDMid).toBeLessThan(0.001);
    expect(run('challenges').stats).toMatchObject({ challenges: 29, matched: 29, overturned: 20 });
  });

  it('release to plate in real time takes 0.358-0.503 s', () => {
    const s = run('timing').stats;

    expect(s.min.toFixed(3)).toBe('0.358');
    expect(s.max.toFixed(3)).toBe('0.503');
    expect(s.outOfBand).toBe(0);
  });

  it('deals 590 of the 742; the 152 left out are all at least 6.6 in from flipping', () => {
    const s = run('camera').stats;

    expect(s.dealt).toBe(590);
    expect(s.neverDealt).toBe(152);
    expect(s.closestNeverIn.toFixed(1)).toBe('6.6');
  });

  it('fits the 1440x900 lens at 827 px (52.6°), with every crossing in frame', () => {
    const s = run('camera').stats;

    expect(s.F_1440x900_R.toFixed(0)).toBe('827');
    expect(s.vfov_1440x900_R.toFixed(1)).toBe('52.6');
    expect(s.outOwn + s.outExtreme).toBe(0);
    expect(s.capMinPct).toBeGreaterThanOrEqual(5);
    expect(s.helmetMin).toBeGreaterThan(0);
  });

  it('blurs 20.2 px at 3 ft and 9.6 px at 6 ft at 1440x900, and keeps the pitcher sharp', () => {
    const s = run('dof').stats;

    expect(s.blur3.toFixed(1)).toBe('20.2');
    expect(s.blur6.toFixed(1)).toBe('9.6');
    expect(s.pitcher).toBeLessThan(0.2);
  });

  it('the mitt has covered at most 21% of its reach when the ball crosses mid-plate', () => {
    const s = run('mitt').stats;

    expect((100 * s.maxProgress).toFixed(0)).toBe('21');
    expect(s.overZone).toBe(0);
  });

  it('frames 173 of 270 borderline pitches (90 strikes, 83 balls) by 1-4 in', () => {
    const s = run('framing').stats;

    expect(s).toMatchObject({ border: 270, framed: 173, framedStrikes: 90, framedBalls: 83 });
    expect(s.sizeMin).toBeGreaterThanOrEqual(1);
    expect(s.sizeMax).toBeLessThanOrEqual(4);
  });

  it('moves the zone on the glass: 33 px (RHB) and 41 px (LHB) for the inside edge at 1440x900', () => {
    const s = run('stance').stats;

    expect(s.insideSpread_R.toFixed(0)).toBe('33');
    expect(s.insideSpread_L.toFixed(0)).toBe('41');
    expect(s.pitcherMovePx.toFixed(1)).toBe('2.3');
  });

  it('"another ten": the real ump averages 6.8/10 over the 200 seeded deals', () => {
    const s = run('picker').stats;

    expect(s.invalid).toBe(0);
    expect(s.umpMean.toFixed(1)).toBe('6.8');
    expect(s.closeBallsMin).toBeLessThan(s.closeBallsMax);
  });
});
