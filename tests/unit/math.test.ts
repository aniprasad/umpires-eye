import { describe, expect, it } from 'vitest';
import { absJudge } from '../../src/math/abs';
import { BALL_R, LOOK_Y, PLATE_HALF } from '../../src/math/constants';
import { makeCam } from '../../src/math/geometry';
import { posAt, prep, tAtY } from '../../src/math/kinematics';
import { eyeFor } from '../../src/math/stance';
import { synthPitch } from './fixtures';

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
    expect(j.marginIn).toBeCloseTo((BALL_R - Math.hypot(0.1, 0.1)) * 12, 9);
  });

  it('signs the margin: positive inside, negative outside, in inches', () => {
    expect(absJudge(0, 2.4, top, bottom).marginIn).toBeGreaterThan(6);
    expect(absJudge(1.5, 2.4, top, bottom).marginIn).toBeLessThan(-6);
  });
});

describe('kinematics', () => {
  it('finds the time at a plane on the fitted path, before and after y0', () => {
    const tr = synthPitch().traj;

    for (const Y of [60, 50, 8.5 / 12, -1.5]) expect(posAt(tr, tAtY(tr, Y)).y).toBeCloseTo(Y, 9);
    expect(tAtY(tr, tr.y0)).toBe(0);
    expect(tAtY(tr, 55)).toBeLessThan(0);
  });

  it('releases at 60.5 ft minus the extension and judges the mid-plate crossing', () => {
    const P = prep(synthPitch());

    expect(P.k.rel.y).toBeCloseTo(60.5 - 6.5, 9);
    expect(P.k.toMid).toBeGreaterThan(0);
    expect(P.k.toCatch).toBeGreaterThan(P.k.toMid);
    expect(P.k.judge.strike).toBe(absJudge(P.k.mid.x, P.k.mid.z, 3.2, 1.6).strike);
  });
});

describe('camera', () => {
  it('aims the level axis at the look point from the slot', () => {
    const eye = eyeFor('R');
    const yaw = Math.atan2(-eye.x, LOOK_Y - eye.y);
    const cam = makeCam(eye, yaw, 800, 700, 160, 1440, 900);
    const q = cam.p({ x: 0, y: LOOK_Y, z: eye.z });

    expect(q.x).toBeCloseTo(700, 9);
    expect(q.y).toBeCloseTo(160, 9);
  });
});
