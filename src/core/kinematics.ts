import { MAX_FLIGHT_S, MID_Y, PLATE_FRONT_Y, RUBBER_Y } from './rules.ts';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The feed's 9-parameter constant-acceleration fit, p(t) = p0 + v0·t + ½·a·t², with t = 0 at y0 (about 50 ft). */
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

export const TRAJ_KEYS = ['x0', 'y0', 'z0', 'vX0', 'vY0', 'vZ0', 'aX', 'aY', 'aZ'] as const;

export function posAt(tr: Traj, t: number): Vec3 {
  return {
    x: tr.x0 + tr.vX0 * t + 0.5 * tr.aX * t * t,
    y: tr.y0 + tr.vY0 * t + 0.5 * tr.aY * t * t,
    z: tr.z0 + tr.vZ0 * t + 0.5 * tr.aZ * t * t,
  };
}

/** The root of y(t) = y nearest 0, so it's negative behind y0 (at release). */
export function tAtY(tr: Traj, y: number): number {
  const c = tr.y0 - y;

  return (2 * c) / (-tr.vY0 + Math.sqrt(tr.vY0 * tr.vY0 - 2 * tr.aY * c));
}

export function crossing(tr: Traj, y: number = MID_Y): Vec3 {
  return posAt(tr, tAtY(tr, y));
}

/** Release is at y = 60.5 ft less the extension. */
export function releaseT(tr: Traj, extension: number): number {
  return tAtY(tr, RUBBER_Y - extension);
}

/** Seconds from release to the front of the plate. */
export function flightTime(tr: Traj, extension: number): number {
  return tAtY(tr, PLATE_FRONT_Y) - releaseT(tr, extension);
}

export const quickEnough = (tr: Traj, extension: number): boolean => flightTime(tr, extension) <= MAX_FLIGHT_S;
