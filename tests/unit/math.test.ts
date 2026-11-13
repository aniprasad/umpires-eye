import { describe, expect, it } from 'vitest';
import { absJudge } from '../../src/core/abs.ts';
import { LOOK_Y } from '../../src/math/constants';
import { makeCam } from '../../src/math/geometry';
import { prep } from '../../src/math/kinematics';
import { eyeFor } from '../../src/math/stance';
import { synthPitch } from './fixtures';

describe('kinematics', () => {
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
