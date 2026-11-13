import { BALL_R, DEAL_BOX, MID_Y, PLATE_HALF, RUBBER_Y } from './constants.ts';

export interface Traj {
  x0: number;
  y0: number;
  z0: number;
  vX0: number;
  vY0: number;
  vZ0: number;
  aX: number;
  aY: number;
  aZ: number;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface Judgement {
  strike: boolean;
  marginIn: number;
}

export const TRAJ_KEYS = ['x0', 'y0', 'z0', 'vX0', 'vY0', 'vZ0', 'aX', 'aY', 'aZ'] as const;

export function posAt(tr: Traj, t: number): Point {
  return {
    x: tr.x0 + tr.vX0 * t + 0.5 * tr.aX * t * t,
    y: tr.y0 + tr.vY0 * t + 0.5 * tr.aY * t * t,
    z: tr.z0 + tr.vZ0 * t + 0.5 * tr.aZ * t * t,
  };
}

// The feed's fit has t = 0 at y0 (50 ft). This is the root nearest 0, so it is negative behind y0 (at release).
export function tAtY(tr: Traj, y: number): number {
  const c = tr.y0 - y;

  return (2 * c) / (-tr.vY0 + Math.sqrt(tr.vY0 * tr.vY0 - 2 * tr.aY * c));
}

export function crossing(tr: Traj, y: number = MID_Y): Point {
  return posAt(tr, tAtY(tr, y));
}

export function releaseT(tr: Traj, extension: number): number {
  return tAtY(tr, RUBBER_Y - extension);
}

// A strike if any part of the ball touches the zone rectangle: the distance from the ball's centre to the rectangle is
// at most the radius, which rounds the corners. marginIn is how far the ball would have to move to flip the call,
// positive for strikes.
export function absJudge(x: number, z: number, top: number, bottom: number, radius: number = BALL_R): Judgement {
  const dx = Math.abs(x) - PLATE_HALF;
  const dz = Math.max(bottom - z, z - top);
  const d = dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);

  return { strike: d <= radius, marginIn: (radius - d) * 12 };
}

// The brief's square-cornered rule. It differs from absJudge only at the corners; kept for the validation table.
export function boxStrike(x: number, z: number, top: number, bottom: number, radius: number = BALL_R): boolean {
  return Math.abs(x) <= PLATE_HALF + radius && z >= bottom - radius && z <= top + radius;
}

export function inDealBox(mid: { x: number; z: number }): boolean {
  return mid.z > DEAL_BOX.zMin && mid.z < DEAL_BOX.zMax && Math.abs(mid.x) < DEAL_BOX.xMax;
}
