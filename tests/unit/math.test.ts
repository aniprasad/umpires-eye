import { describe, expect, it, vi } from 'vitest';
import { absJudge } from '../../src/core/abs.ts';
import { mulberry32 } from '../../src/core/rng.ts';
import { LOOK_Y } from '../../src/math/constants';
import { makeCam } from '../../src/math/geometry';
import { prep } from '../../src/math/kinematics';
import { figureArm, pitcherPose } from '../../src/math/pitcher';
import { eyeFor } from '../../src/math/stance';
import type { Side } from '../../src/math/types';
import { decorRandom } from '../../src/render/noise';
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

describe("the pitcher figure's throwing side (§4.7)", () => {
  // a path straight along y, so the release point's x is relX whatever the extension
  const releasedAt = (hand: Side, relX: number) => prep(synthPitch({
    pitcher: { id: 20, name: 'Pat Sample', hand },
    traj: { x0: relX, y0: 50, z0: 5, vX0: 0, vY0: -130, vZ0: -5, aX: 0, aY: 25, aZ: -20 },
  }));

  it('mirrors a figure released 1 ft past the centre line, to the side that reaches the release point', () => {
    expect([figureArm('R', 1), figureArm('L', -1)]).toEqual([1, -1]);
  });

  it('keeps the listed hand for a release on the arm side, or 0.3 ft past the centre line', () => {
    expect([figureArm('R', -1.9), figureArm('R', 0.3), figureArm('L', 1.9), figureArm('L', -0.3)]).toEqual([-1, -1, 1, 1]);
  });

  it('still lands the hand exactly on the release point at release, the throwing shoulder on the side it throws from', () => {
    for (const [hand, relX] of [['R', -1.9], ['R', 0.3], ['R', 1], ['L', -1]] as const) {
      const P = releasedAt(hand, relX);
      const pose = pitcherPose(P, 0);

      expect(P.k.rel.x).toBeCloseTo(relX, 12);
      expect(Math.hypot(pose.tHa.x - P.k.rel.x, pose.tHa.y - P.k.rel.y, pose.tHa.z - P.k.rel.z)).toBeLessThan(1e-9);
      expect(Math.sign(pose.tSh.x - pose.gSh.x)).toBe(figureArm(hand, relX));
    }
  });
});

describe('decorative noise', () => {
  it('paints the same grain on every load: its own stream, with the seed the parity tests give the mockup', () => {
    const random = vi.spyOn(Math, 'random');

    try {
      expect(Array.from({ length: 5 }, () => decorRandom())).toEqual(Array.from({ length: 5 }, mulberry32(20261113)));
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
});
