import type { Vec3 } from '../core/kinematics.ts';
import { RUBBER_Y } from '../core/rules.ts';
import { MOUND_H } from './constants';
import { groundZ } from './geometry';
import type { PreparedPitch } from './kinematics';
import type { Side } from './types';
import { clamp } from './util';

/**
 * One generic delivery for every pitcher, mirrored for lefties. Local frame: u = throwing-arm side, v = toward the
 * plate, w = up from the rubber top. Key times are seconds from release; the hand is pinned to the real release point
 * at s = 0.
 */
export const PJ = ['head', 'neck', 'tSh', 'gSh', 'tEl', 'gEl', 'tHa', 'gHa', 'pel', 'tHip', 'gHip', 'tKn', 'gKn', 'tFt', 'gFt'] as const;

export type PitcherJoint = (typeof PJ)[number];
export type PitcherPose = Record<PitcherJoint, Vec3>;
type Key = readonly (readonly [number, number, number])[];

export const PT: readonly number[] = [-1.15, -0.72, -0.42, -0.13, -0.045, 0, 0.28, 0.75];

const PK: readonly Key[] = [
  /* set    */ [[0.05, 0.75, 5.80], [0.02, 0.70, 5.32], [0.05, 0.10, 5.05], [0.00, 1.25, 5.08], [0.45, 0.25, 4.15], [0.40, 1.15, 4.15], [0.62, 0.68, 4.35], [0.62, 0.78, 4.40], [0.00, 0.70, 3.25], [0.00, 0.32, 3.25], [0.00, 1.08, 3.25], [0.12, 0.30, 1.70], [0.12, 1.25, 1.70], [0.05, 0.10, 0.04], [0.05, 1.45, 0.00]],
  /* lift   */ [[0.10, 0.55, 5.85], [0.08, 0.50, 5.36], [0.18, -0.05, 5.10], [-0.10, 1.05, 5.12], [0.55, 0.05, 4.25], [0.40, 0.95, 4.30], [0.65, 0.45, 4.55], [0.62, 0.55, 4.60], [0.05, 0.45, 3.30], [0.05, 0.10, 3.30], [0.05, 0.85, 3.32], [0.10, 0.10, 1.75], [0.55, 0.75, 3.55], [0.05, 0.10, 0.04], [0.30, 0.70, 2.15]],
  /* stride */ [[0.05, 1.30, 5.55], [0.05, 1.25, 5.10], [0.12, 0.65, 4.85], [-0.08, 1.75, 4.90], [0.45, 0.15, 4.20], [0.25, 2.10, 4.50], [0.40, 0.25, 3.90], [0.15, 2.55, 4.55], [0.05, 1.30, 2.95], [0.05, 0.95, 2.95], [0.05, 1.65, 2.97], [0.10, 0.75, 1.45], [0.30, 2.30, 2.45], [0.05, 0.10, 0.04], [0.20, 2.80, 1.10]],
  /* plant  */ [[0.00, 3.10, 5.05], [0.00, 3.00, 4.62], [0.30, 2.30, 4.45], [-0.35, 3.40, 4.50], [1.10, 1.95, 4.40], [-0.55, 4.15, 4.30], [1.05, 1.55, 5.25], [-0.40, 4.55, 4.05], [0.05, 2.80, 2.55], [0.35, 2.55, 2.55], [-0.25, 3.05, 2.55], [0.30, 1.75, 0.95], [-0.05, 4.65, 1.35], [0.20, 0.55, 0.20], [-0.05, 5.35, -0.30]],
  /* cocked */ [[0.05, 3.85, 4.75], [0.05, 3.75, 4.35], [0.70, 3.40, 4.30], [-0.55, 3.95, 4.20], [1.35, 3.70, 4.55], [-0.75, 4.55, 3.85], [1.30, 3.30, 5.25], [-0.45, 4.35, 3.70], [0.10, 3.45, 2.45], [0.45, 3.25, 2.45], [-0.30, 3.70, 2.45], [0.40, 2.45, 0.85], [-0.05, 4.95, 1.40], [0.25, 1.05, 0.40], [-0.05, 5.35, -0.30]],
  /* release*/ [[0.15, 4.45, 4.55], [0.15, 4.35, 4.15], [0.80, 4.30, 4.15], [-0.45, 4.55, 3.95], [1.25, 5.05, 4.55], [-0.70, 4.90, 3.55], [1.10, 6.10, 4.85], [-0.30, 4.55, 3.50], [0.10, 3.90, 2.40], [0.45, 3.70, 2.40], [-0.30, 4.10, 2.40], [0.40, 2.95, 0.85], [-0.05, 5.10, 1.45], [0.30, 1.55, 0.55], [-0.05, 5.35, -0.30]],
  /* follow */ [[-0.05, 5.05, 4.20], [-0.05, 4.90, 3.85], [0.30, 5.05, 3.75], [-0.80, 4.55, 3.80], [-0.10, 5.65, 2.90], [-1.00, 4.45, 3.30], [-0.75, 5.35, 2.25], [-0.65, 4.65, 3.05], [-0.05, 4.35, 2.35], [0.30, 4.20, 2.40], [-0.40, 4.45, 2.35], [0.45, 3.60, 1.95], [-0.10, 5.30, 1.45], [0.55, 2.70, 2.35], [-0.05, 5.35, -0.30]],
  /* settle */ [[0.20, 5.35, 5.45], [0.20, 5.25, 5.00], [0.85, 5.20, 4.80], [-0.45, 5.25, 4.80], [0.95, 5.55, 3.95], [-0.55, 5.60, 4.00], [0.55, 5.85, 3.60], [-0.05, 5.90, 3.80], [0.20, 5.15, 2.85], [0.60, 5.10, 2.85], [-0.20, 5.20, 2.85], [0.95, 5.55, 1.45], [-0.40, 5.60, 1.45], [1.00, 5.25, -0.40], [-0.45, 5.40, -0.41]],
];

const REL_KEY = PT.indexOf(0);
const HAND = PJ.indexOf('tHa');
/** How far the frame may pull the hand toward the glove side before the figure throws from the other side. */
const MAX_GLOVE_PULL = 0.5;

interface PitcherFrame {
  /** World x sign of the throwing side. */
  arm: number;
  xBody: number;
  /** What the release key's hand needs to land on the real release point. */
  delta: Vec3;
}

const FRAMES = new WeakMap<PreparedPitch, PitcherFrame>();

// the body 1.1 ft to the glove side of release, with the pivot foot on the 24 in rubber
const bodyX = (arm: number, relX: number): number => clamp(relX - arm * 1.10, -1.0, 1.0);

/**
 * The world x sign of the figure's throwing side, from the release point. It's the listed hand's, unless that
 * frame would drag the hand more than 0.5 ft across the body to the release point, as for a release past the plate's
 * centre line; then it's the other side's, which reaches the release point. The matchup card keeps the listed hand.
 */
export function figureArm(hand: Side, relX: number): number {
  const listed = hand === 'L' ? 1 : -1;
  const pull = -listed * (relX - (bodyX(listed, relX) + listed * PK[REL_KEY][HAND][0]));

  return pull > MAX_GLOVE_PULL ? -listed : listed;
}

function pitcherFrame(P: PreparedPitch): PitcherFrame {
  const hit = FRAMES.get(P);

  if (hit) return hit;
  const arm = figureArm(P.pitcher.hand, P.k.rel.x);
  const xBody = bodyX(arm, P.k.rel.x);
  const b = PK[REL_KEY][HAND];
  const hand0 = { x: xBody + arm * b[0], y: RUBBER_Y - b[1], z: MOUND_H + b[2] };
  const delta = { x: P.k.rel.x - hand0.x, y: P.k.rel.y - hand0.y, z: P.k.rel.z - hand0.z };
  const fr = { arm, xBody, delta };

  FRAMES.set(P, fr);

  return fr;
}

/** The pose at scene time s (seconds from release): a cubic Hermite through the keys, with the hand pulled onto the
 * real release point exactly at s = 0. */
export function pitcherPose(P: PreparedPitch, s: number): PitcherPose {
  const T = PT;
  const K = PK;
  const n = T.length;
  const fr = pitcherFrame(P);
  const sc = clamp(s, T[0], T[n - 1]);
  let i = 0;

  while (i < n - 2 && sc > T[i + 1]) i++;
  const h = T[i + 1] - T[i];
  const u = (sc - T[i]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const tan = (k: number, j: number, c: number): number => {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);

    return (K[b][j][c] - K[a][j][c]) / (T[b] - T[a]);
  };
  const out = {} as PitcherPose;

  for (let j = 0; j < PJ.length; j++) {
    const v = [0, 1, 2].map((c) => h00 * K[i][j][c] + h10 * h * tan(i, j, c) + h01 * K[i + 1][j][c] + h11 * h * tan(i + 1, j, c));

    out[PJ[j]] = { x: fr.xBody + fr.arm * v[0], y: RUBBER_Y - v[1], z: MOUND_H + v[2] };
  }
  const w = Math.exp(-Math.pow(s / 0.14, 2));
  const d = fr.delta;
  const add = (name: PitcherJoint, f: number): void => {
    const o = out[name];

    o.x += d.x * f;
    o.y += d.y * f;
    o.z += d.z * f;
  };

  add('tHa', w);
  add('tEl', 0.6 * w);
  add('tSh', 0.3 * w);
  add('neck', 0.15 * w);
  add('head', 0.15 * w);
  add('gSh', 0.1 * w);
  for (const f of ['tFt', 'gFt'] as const) out[f].z = Math.max(out[f].z, groundZ(out[f].x, out[f].y) + 0.04);

  return out;
}
