import { absJudge, type AbsJudgement } from './abs';
import { CATCH_Y, MID_Y, PLATE_FRONT, RUBBER_Y } from './constants';
import type { Pitch, Traj, Vec3 } from './types';

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

export function posAt(tr: Traj, t: number): Vec3 {
  return {
    x: tr.x0 + tr.vX0 * t + 0.5 * tr.aX * t * t,
    y: tr.y0 + tr.vY0 * t + 0.5 * tr.aY * t * t,
    z: tr.z0 + tr.vZ0 * t + 0.5 * tr.aZ * t * t,
  };
}

/** The root of y(t) = Y nearest 0 (negative when Y > y0). */
export function tAtY(tr: Traj, Y: number): number {
  const c = tr.y0 - Y;

  return 2 * c / (-tr.vY0 + Math.sqrt(tr.vY0 * tr.vY0 - 2 * tr.aY * c));
}

export function prep(p: Pitch): PreparedPitch {
  const tr = p.traj;
  const tRel = tAtY(tr, RUBBER_Y - p.extension);
  const tMid = tAtY(tr, MID_Y);
  const tFront = tAtY(tr, PLATE_FRONT);
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
