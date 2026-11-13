import { CATCH_Y, EYE, FRAME, MID_Y, MITT_MOVE, MITT_SETUP_Z, PLATE_HALF } from './constants';
import { projPoly, type Cam, type Rect } from './geometry';
import type { PreparedPitch } from './kinematics';
import { gauss, hash32, rng } from './rng';
import { eyeFor, eyeOf } from './stance';
import { clamp, lerp, smooth } from './util';
import type { Side, Vec3 } from './types';

export interface CatcherRig {
  head: Vec3;
  r: number;
  /** The ump's side of the plate: -1 for a right-handed batter. */
  sgn: number;
}

/**
 * The ump keys his stance off the catcher (head in the slot, eyes just over the helmet) and the catcher sets up to the
 * batter too. So the helmet follows the ump's eye by the share (1 − its depth / mid-plate depth) that moves it on
 * screen with the plate and the zone, and it stays under the zone from every stance. `eye` defaults to the slot.
 */
export function catcherRig(side: Side, eye?: Vec3): CatcherRig {
  const sgn = side === 'R' ? -1 : 1;
  const n = eyeFor(side);
  const e = eye || n;
  const k = 1 - (-2.3 - EYE.y) / (MID_Y - EYE.y);

  return { head: { x: -sgn * 0.05 + k * (e.x - n.x), y: -2.3 + k * (e.y - n.y), z: 2.78 + k * (e.z - n.z) }, r: 0.42, sgn };
}

const SETUPS = new WeakMap<PreparedPitch, Vec3>();

/**
 * The catcher sets up on the pitcher's intended spot: the real crossing plus a seeded command error (SD 7 in), with
 * the glove held low, under every crossing, until the ball arrives. So the mitt gives nothing away.
 */
export function mittSetup(P: PreparedPitch): Vec3 {
  const hit = SETUPS.get(P);

  if (hit) return hit;
  const r = rng(hash32(P.id));
  const o = { x: clamp(P.k.mid.x + gauss(r) * (7 / 12), -1.3, 1.3), y: CATCH_Y, z: MITT_SETUP_Z };

  SETUPS.set(P, o);

  return o;
}

/** The share of the way from the setup to the catch point: a quartic ease-in over the last MITT_MOVE seconds. */
export function mittProgress(P: PreparedPitch, s: number): number {
  const u = clamp((s - (P.k.toCatch - MITT_MOVE)) / MITT_MOVE, 0, 1);

  return u * u * u * u;
}

export interface Frame {
  /** Direction toward the zone's interior from its nearest edge (corners: toward the nearest point of the zone). */
  dx: number;
  dz: number;
  /** How far, ft. */
  ft: number;
  dur: number;
}

const FRAMES = new WeakMap<PreparedPitch, Frame | null>();

/** This pitch's framing, seeded so replays and tests see the same one, or null when it isn't framed. */
export function frameOf(P: PreparedPitch): Frame | null {
  const hit = FRAMES.get(P);

  if (hit !== undefined) return hit;
  const f = computeFrame(P);

  FRAMES.set(P, f);

  return f;
}

function computeFrame(P: PreparedPitch): Frame | null {
  const r = rng(hash32('frame|' + P.id));
  const u = r();
  const size = r();
  const dur = r();

  if (Math.abs(P.k.judge.marginIn) > FRAME.band || u > FRAME.p) return null;
  const x = P.k.mid.x;
  const z = P.k.mid.z;
  const Z = P.zone;
  const dx = Math.abs(x) - PLATE_HALF;
  const db = Z.bottom - z;
  const dt = z - Z.top;
  let vx = 0;
  let vz = 0;

  if (dx > 0 && Math.max(db, dt) > 0) {
    vx = -Math.sign(x) * dx;
    vz = db > dt ? db : -dt;
  } else if (dx >= Math.max(db, dt)) vx = -Math.sign(x);
  else vz = db > dt ? 1 : -1;
  const n = Math.hypot(vx, vz);

  if (!n) return null;

  return { dx: vx / n, dz: vz / n, ft: lerp(FRAME.minIn, FRAME.maxIn, size) / 12, dur: lerp(FRAME.durMin, FRAME.durMax, dur) };
}

/** How far (ft) the glove has been framed, dt seconds after the catch: nothing before the pop is absorbed. */
export function frameShift(P: PreparedPitch, dt: number, f: Frame | null = frameOf(P)): number {
  return !f || dt <= FRAME.t0 ? 0 : f.ft * smooth((dt - FRAME.t0) / f.dur);
}

export interface MittState {
  p: Vec3;
  pop: number;
  m: CatcherRig;
}

/**
 * The glove at scene time s: held at the setup, a late fast reach to the real arrival point, the pop on the catch, a
 * short hold (framed toward the zone on some borderline pitches), then the drop. Pass `frame = null` to switch
 * framing off.
 */
export function mittState(P: PreparedPitch, s: number, frame: Frame | null = frameOf(P)): MittState {
  const m = catcherRig(P.batter.side, eyeOf(P));
  const a = P.k.catchP;
  const tc = P.k.toCatch;
  const o = mittSetup(P);

  if (s < tc) {
    const e = mittProgress(P, s);

    return { p: { x: lerp(o.x, a.x, e), y: CATCH_Y, z: lerp(o.z, a.z, e) }, pop: 0, m };
  }
  const dt = s - tc;
  const amp = dt < 0.03 ? dt / 0.03 : Math.max(0, 1 - (dt - 0.03) / 0.24);
  const e = smooth(amp);
  const drop = smooth((dt - 0.45) / 0.35);
  const fs = frameShift(P, dt, frame);

  return {
    p: {
      x: a.x + (frame ? frame.dx * fs : 0),
      y: CATCH_Y - 0.14 * e - 0.3 * drop,
      z: a.z - 0.05 * e - 1.8 * drop + (frame ? frame.dz * fs : 0),
    },
    pop: e,
    m,
  };
}

/** The glove outline in world space around its pocket centre: a 10 × 11 in mitt face, square to the plate. */
export function mittPts(p: Vec3): Vec3[] {
  const pts: Vec3[] = [];

  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);

    pts.push({
      x: p.x + 0.43 * Math.sign(ca) * Math.pow(Math.abs(ca), 0.85),
      y: p.y,
      z: p.z + (sa > 0 ? 0.47 : 0.42) * Math.sign(sa) * Math.pow(Math.abs(sa), 0.85),
    });
  }

  return pts;
}

export function mittBox(cam: Cam, P: PreparedPitch, s: number): Rect | null {
  const sp = projPoly(cam, mittPts(mittState(P, s).p));

  if (sp.length < 3) return null;
  const xs = sp.map((q) => q.x);
  const ys = sp.map((q) => q.y);

  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}
