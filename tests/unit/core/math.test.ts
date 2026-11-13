import { describe, expect, it } from 'vitest';
import { absJudge, boxStrike, inDealBox } from '../../../src/core/abs.ts';
import { crossing, flightTime, posAt, quickEnough, releaseT, tAtY, type Traj } from '../../../src/core/kinematics.ts';
import { hash32, mulberry32, unitHash } from '../../../src/core/rng.ts';
import { BALL_R, MAX_FLIGHT_S, MID_Y, PLATE_FRONT_Y, PLATE_HALF, RUBBER_Y } from '../../../src/core/rules.ts';

describe('the seeded draws', () => {
  it('hash32 is FNV-1a', () => {
    expect(hash32('')).toBe(0x811c9dc5);
    expect(hash32('a')).toBe(0xe40c292c);
    expect(hash32('foobar')).toBe(0xbf9cf968);
    expect(hash32('umpires-eye-2026')).toBe(3220614827);
  });

  it('mulberry32 gives the same draws per seed, and unitHash is the hash over 2^32', () => {
    const r = mulberry32(42);
    const draws = Array.from({ length: 10_000 }, mulberry32(7));

    expect([r(), r(), r()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
    expect(mulberry32(0)()).toBe(0.26642920868471265);
    expect(draws.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(draws.reduce((s, v) => s + v, 0) / draws.length).toBeCloseTo(0.5, 1);
    expect(unitHash('umpires-eye-2026')).toBe(3220614827 / 2 ** 32);
  });
});

describe('ABS truth', () => {
  const top = 3.2;
  const bottom = 1.6;

  it('is a strike when any part of the ball touches the zone', () => {
    expect(absJudge(PLATE_HALF + BALL_R * 0.99, 2.4, top, bottom).strike).toBe(true);
    expect(absJudge(PLATE_HALF + BALL_R * 1.01, 2.4, top, bottom).strike).toBe(false);
    expect(absJudge(0, bottom - BALL_R * 0.99, top, bottom).strike).toBe(true);
  });

  it('rounds the corners: a ball diagonally off a corner is a ball even inside the box rule', () => {
    const j = absJudge(PLATE_HALF + 0.1, top + 0.1, top, bottom);

    expect(j.strike).toBe(false);
    expect(boxStrike(PLATE_HALF + 0.1, top + 0.1, top, bottom)).toBe(true);
    expect(j.marginIn).toBeCloseTo((BALL_R - Math.hypot(0.1, 0.1)) * 12, 9);
  });

  it('signs the margin in inches to the nearest edge: positive inside, negative outside', () => {
    const justOut = absJudge(-(PLATE_HALF + BALL_R + 0.01 / 12), 2.4, top, bottom);

    expect(absJudge(0, 2.4, top, bottom).marginIn).toBeCloseTo(1.45 + 8.5, 9);
    expect(absJudge(PLATE_HALF + BALL_R - 1e-12, 2.4, top, bottom).marginIn).toBeCloseTo(0, 9);
    expect(justOut.strike).toBe(false);
    expect(justOut.marginIn).toBeCloseTo(-0.01, 9);
    expect(absJudge(1.5, 2.4, top, bottom).marginIn).toBeLessThan(-6);
  });

  it('turns edge strikes into balls without the ball radius', () => {
    expect(absJudge(PLATE_HALF + BALL_R / 2, 2.4, top, bottom).strike).toBe(true);
    expect(absJudge(PLATE_HALF + BALL_R / 2, 2.4, top, bottom, 0).strike).toBe(false);
  });

  it("calls 849799-5-4 a ball by 0.22 in, the one World Series pitch the box rule calls a strike", () => {
    const traj: Traj = { x0: -1.7313, y0: 50.0009, z0: 5.0449, vX0: 10.8167, vY0: -146.8419, vZ0: -7.7004, aX: -20.4378, aY: 37.4971, aZ: -12.9357 };
    const mid = crossing(traj);
    const j = absJudge(mid.x, mid.z, 3.244, 1.637);

    expect([mid.x.toFixed(4), mid.z.toFixed(4)]).toEqual(['0.8080', '1.5396']);
    expect(j.strike).toBe(false);
    expect(j.marginIn.toFixed(2)).toBe('-0.22');
    expect(boxStrike(mid.x, mid.z, 3.244, 1.637)).toBe(true);
    expect(flightTime(traj, 7.4791).toFixed(4)).toBe('0.3667');
  });
});

describe('kinematics', () => {
  const tr: Traj = { x0: 0, y0: 50, z0: 5, vX0: 0, vY0: -130, vZ0: -5, aX: 0, aY: 25, aZ: -20 };
  const steady = (mph: number): Traj => ({ x0: 0, y0: 50, z0: 2.5, vX0: 0, vY0: -mph * (5280 / 3600), vZ0: 0, aX: 0, aY: 0, aZ: 0 });

  it('finds the time at a plane on the fitted path, before and after y0', () => {
    for (const Y of [60, 50, MID_Y, -1.5]) expect(posAt(tr, tAtY(tr, Y)).y).toBeCloseTo(Y, 9);
    expect(tAtY(tr, tr.y0)).toBe(0);
    expect(tAtY(tr, 55)).toBeLessThan(0);
    expect(tAtY({ ...tr, aY: 0 }, MID_Y)).toBeCloseTo((50 - MID_Y) / 130, 12);
    expect(crossing(tr).y).toBeCloseTo(MID_Y, 12);
    expect(posAt(tr, releaseT(tr, 6.5)).y).toBeCloseTo(RUBBER_Y - 6.5, 9);
  });

  it('times the flight from release to the front of the plate, and deals only pitches quick enough', () => {
    const travel = RUBBER_Y - 6.5 - PLATE_FRONT_Y;

    expect(flightTime(steady(90), 6.5)).toBeCloseTo(travel / (90 * (5280 / 3600)), 12);
    // About 60 mph all the way is right at the bound; an eephus is slower still.
    expect(MAX_FLIGHT_S).toBe(0.6);
    expect(quickEnough(steady(61), 6.5)).toBe(true);
    expect(quickEnough(steady(59), 6.5)).toBe(false);
  });
});

describe('the deal box', () => {
  it('excludes its own edges', () => {
    expect(inDealBox({ x: 0, z: 0.9 })).toBe(false);
    expect(inDealBox({ x: 0, z: 0.9001 })).toBe(true);
    expect(inDealBox({ x: 0, z: 4.5 })).toBe(false);
    expect(inDealBox({ x: 0, z: 4.4999 })).toBe(true);
    expect(inDealBox({ x: -1.5, z: 2 })).toBe(false);
    expect(inDealBox({ x: 1.4999, z: 2 })).toBe(true);
  });
});
