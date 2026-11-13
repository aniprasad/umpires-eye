import { BALL_R, DEAL_BOX, PLATE_HALF } from './rules.ts';

export interface AbsJudgement {
  strike: boolean;
  /** How far the ball would have to move to flip the call, in inches: positive is a strike. */
  marginIn: number;
  /** How far the ball's centre is past the plate's half-width, and past the nearer end of the zone (negative inside). */
  dx: number;
  dz: number;
}

/**
 * The ABS rule as reconstructed: a strike if any part of the ball touches the 17 in wide [bottom, top] rectangle at
 * mid-plate. It's the exact disc geometry, so the corners are rounded by the ball's radius.
 */
export function absJudge(x: number, z: number, top: number, bottom: number, radius: number = BALL_R): AbsJudgement {
  const dx = Math.abs(x) - PLATE_HALF;
  const dz = Math.max(bottom - z, z - top);
  const d = dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);

  return { strike: d <= radius, marginIn: (radius - d) * 12, dx, dz };
}

/** The brief's square-cornered rule. It differs from absJudge only at the corners. */
export function boxStrike(x: number, z: number, top: number, bottom: number, radius: number = BALL_R): boolean {
  return Math.abs(x) <= PLATE_HALF + radius && z >= bottom - radius && z <= top + radius;
}

/** Inside the deal box at mid-plate, edges excluded. */
export function inDealBox(mid: { x: number; z: number }): boolean {
  return mid.z > DEAL_BOX.zMin && mid.z < DEAL_BOX.zMax && Math.abs(mid.x) < DEAL_BOX.xMax;
}
