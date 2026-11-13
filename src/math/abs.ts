import { BALL_R, PLATE_HALF } from './constants';

export interface AbsJudgement {
  strike: boolean;
  /** How far the ball would have to move to flip the call, in inches: positive is a strike. */
  marginIn: number;
  dx: number;
  dz: number;
}

/**
 * The ABS rule as reconstructed: a strike if any part of the ball touches the 17 in wide [bottom, top] rectangle at
 * mid-plate. It's the exact disc geometry, so the corners are rounded by the ball's radius.
 */
export function absJudge(x: number, z: number, top: number, bottom: number): AbsJudgement {
  const dx = Math.abs(x) - PLATE_HALF;
  const dz = Math.max(bottom - z, z - top);
  const d = dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz);

  return { strike: d <= BALL_R, marginIn: (BALL_R - d) * 12, dx, dz };
}
