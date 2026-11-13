import { absJudge, type AbsJudgement } from '../core/abs.ts';
import { posAt, tAtY } from '../core/kinematics.ts';
import { MID_Y, PLATE_FRONT_Y, RUBBER_Y } from '../core/rules.ts';
import { CATCH_Y } from './constants';
import type { Pitch, Vec3 } from './types';

export { posAt, tAtY } from '../core/kinematics.ts';

export interface Kinematics {
  tRel: number;
  tMid: number;
  tFront: number;
  tCatch: number;
  rel: Vec3;
  mid: Vec3;
  front: Vec3;
  catchP: Vec3;
  /** Release to the front of the plate, s. */
  flight: number;
  toMid: number;
  toCatch: number;
  judge: AbsJudgement;
}

export interface PreparedPitch extends Pitch {
  readonly k: Kinematics;
}

export function prep(p: Pitch): PreparedPitch {
  const tr = p.traj;
  const tRel = tAtY(tr, RUBBER_Y - p.extension);
  const tMid = tAtY(tr, MID_Y);
  const tFront = tAtY(tr, PLATE_FRONT_Y);
  const tCatch = tAtY(tr, CATCH_Y);
  const mid = posAt(tr, tMid);
  const k: Kinematics = {
    tRel,
    tMid,
    tFront,
    tCatch,
    rel: posAt(tr, tRel),
    mid,
    front: posAt(tr, tFront),
    catchP: posAt(tr, tCatch),
    flight: tFront - tRel,
    toMid: tMid - tRel,
    toCatch: tCatch - tRel,
    judge: absJudge(mid.x, mid.z, p.zone.top, p.zone.bottom),
  };

  return { ...p, k };
}

/** The renderer's only clock-to-trajectory mapping: s is real seconds since release, so there's no slow motion. */
export const ballT = (P: PreparedPitch, s: number): number => P.k.tRel + s;
