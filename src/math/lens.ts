import { BALL_R, CROSS_PAD, HUD, LOOK_Y, MID_Y, MOUND_H, PITCHER_ROOM, PLATE_HALF, RUBBER_Y } from './constants';
import { makeCam, withUnion, type Cam, type Extent, type LensCam } from './geometry';
import type { PreparedPitch } from './kinematics';
import { eyeFor, eyeOf, stanceCorners } from './stance';
import { clamp } from './util';
import type { Side } from './types';

/** A mid-plate crossing the game can deal. */
export interface PlayPoint {
  x: number;
  z: number;
}

/** The screen band (px) the crossings live in, clear of the HUD over the scene. */
export interface Band {
  portrait: boolean;
  t: number;
  b: number;
  l: number;
  r: number;
}

export function camBand(W: number, H: number): Band {
  // phone: under the verdict and over the indicator
  if (W / H < 0.9) return { portrait: true, t: Math.max(0.2 * H, 180), b: H - 234, l: 6, r: W - 6 };
  const sd = Math.min(HUD.side, 0.2 * W);

  return { portrait: false, t: 6, b: H - 6, l: sd, r: W - sd };
}

export interface Lens {
  readonly playPts: readonly PlayPoint[];
  /** The unit-camera extent of every dealt crossing, ball and air included (independent of the screen). */
  crossExt(u: Cam): Extent;
  /** The viewport's lens for a batter side, fitted once: F, the principal point and the yaw then stay put. */
  fitCam(W: number, H: number, side: Side): LensCam;
  /** The camera for one pitch: the viewport's lens, this pitch's eye. */
  camFor(W: number, H: number, P: PreparedPitch): LensCam;
}

/**
 * One hard constraint sets the lens: every crossing the game can deal (plus the ball and a little air) is in frame
 * from every stance the ump can take (the 8 corners of the stance box). The frame's top is the higher of the highest
 * crossing and the pitcher's cap plus a little sky. The lens depends on the dealt set, so it's built per dataset.
 */
export function createLens(playPts: readonly PlayPoint[]): Lens {
  const EXT = new Map<string, Extent>();
  const CAMS = new Map<string, LensCam>();

  function crossExt(u: Cam): Extent {
    const key = `${u.eye.x}|${u.eye.y}|${u.eye.z}|${u.yaw}`;
    const hit = EXT.get(key);

    if (hit) return hit;
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;

    for (const c of playPts) {
      const q = u.p({ x: c.x, y: MID_Y, z: c.z });
      const r = (BALL_R + CROSS_PAD) * q.k;

      x0 = Math.min(x0, q.x - r);
      x1 = Math.max(x1, q.x + r);
      y0 = Math.min(y0, q.y - r);
      y1 = Math.max(y1, q.y + r);
    }
    const e = { x0, x1, y0, y1 };

    EXT.set(key, e);

    return e;
  }

  function fitCam(W: number, H: number, side: Side): LensCam {
    const key = `${W}|${H}|${side}`;
    const hit = CAMS.get(key);

    if (hit) return hit;
    const eye = eyeFor(side);
    const yaw = Math.atan2(-eye.x, LOOK_Y - eye.y);
    const u = makeCam(eye, yaw, 1, 0, 0, W, H);
    const us = stanceCorners(side).map((c) => makeCam(c, yaw, 1, 0, 0, W, H));
    const es = us.map((c) => crossExt(c));
    const B = camBand(W, H);
    const e = {
      x0: Math.min(...es.map((q) => q.x0)),
      x1: Math.max(...es.map((q) => q.x1)),
      y0: Math.min(...es.map((q) => q.y0)),
      y1: Math.max(...es.map((q) => q.y1)),
    };
    const capY = Math.min(...us.map((c) => c.p({ x: 0, y: RUBBER_Y - 0.75, z: MOUND_H + 6.2 }).y));
    const top = Math.min(e.y0, capY - PITCHER_ROOM);
    const bot = e.y1;
    const F = Math.min((B.b - B.t) / (bot - top), (B.r - B.l) / (e.x1 - e.x0));
    const cy = B.t + ((B.b - B.t) - F * (bot - top)) / 2 - F * top;
    const zc = u.p({ x: 0, y: MID_Y, z: 2.4 });
    const pit = u.p({ x: 0, y: RUBBER_Y, z: MOUND_H + 3 });
    const want = B.portrait ? (B.l + B.r) / 2 - F * (e.x0 + e.x1) / 2 : W / 2 - F * (zc.x + pit.x) / 2;
    const cx = clamp(want, B.l - F * e.x0, B.r - F * e.x1);
    const cam = makeCam(eye, yaw, F, cx, cy, W, H);
    // what any stance can put on screen, in px: the mask rides on the ump's head, so it keeps clear of all of it
    let zl = 1e9;
    let zr = -1e9;
    let zt = 1e9;
    let zb = -1e9;

    for (const c of us) {
      for (const [x, z] of [[-PLATE_HALF, 3.4], [PLATE_HALF, 3.4], [-PLATE_HALF, 1.5], [PLATE_HALF, 1.5]]) {
        const q = c.p({ x, y: MID_Y, z });

        zl = Math.min(zl, q.x);
        zr = Math.max(zr, q.x);
        zt = Math.min(zt, q.y);
        zb = Math.max(zb, q.y);
      }
    }
    const fitted = withUnion(cam, {
      cross: { l: cx + F * e.x0, r: cx + F * e.x1, t: cy + F * e.y0, b: cy + F * e.y1 },
      zone: { l: cx + F * zl, r: cx + F * zr, t: cy + F * zt, b: cy + F * zb },
    });

    CAMS.set(key, fitted);

    return fitted;
  }

  function camFor(W: number, H: number, P: PreparedPitch): LensCam {
    const b = fitCam(W, H, P.batter.side);

    return withUnion(makeCam(eyeOf(P), b.yaw, b.F, b.cx, b.cy, W, H), b.U);
  }

  return { playPts, crossExt, fitCam, camFor };
}
