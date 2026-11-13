import { makeCam, type Cam, type LensCam, type Pt, type Rect } from './geometry';
import type { Lens } from './lens';
import { clamp } from './util';

/** The indicator's footprint, mirroring its CSS (bottom-right on desktop, bottom-centre and scaled on phones). */
export function indRect(W: number, H: number): Rect {
  return W <= 640
    ? { l: W / 2 - 79, r: W / 2 + 79, t: H - 84 - 113, b: H - 84 }
    : { l: W - 24 - 196, r: W - 24, t: H - 106 - 140, b: H - 106 };
}

/** The screen box of every dealt crossing, seen from this camera's eye. */
export function crossRect(lens: Lens, cam: Cam): Rect {
  const e = lens.crossExt(makeCam(cam.eye, cam.yaw, 1, 0, 0, cam.W, cam.H));

  return { l: cam.cx + cam.F * e.x0, r: cam.cx + cam.F * e.x1, t: cam.cy + cam.F * e.y0, b: cam.cy + cam.F * e.y1 };
}

export type MaskBar =
  | { k: 'arc'; C: Pt; rho: number; sx: number }
  | { k: 'side'; x: number; y0: number; y1: number; sx: number };

export interface MaskGeom {
  bars: MaskBar[];
  /** Bar thickness, px. */
  t: number;
  /** Bar blur, px. */
  bl: number;
  /** Half the bar's footprint, blur included. */
  w: number;
  keep: Rect[];
}

/**
 * The umpire's mask: dark, defocused cage bars at the bottom corners and up the sides. It rides on the ump's head, so
 * it sits in the same place for every stance, clear of what any stance shows: every dealt crossing, the zone and
 * the indicator.
 */
export function maskGeom(cam: LensCam): MaskGeom {
  const W = cam.W;
  const H = cam.H;
  const t = clamp(0.042 * Math.min(W, H), 14, 42);
  const bl = 0.32 * t;
  const w = t / 2 + 2 * bl + 4;
  const U = cam.U;
  const keep = [U.cross, indRect(W, H), U.zone];
  const dist = (x: number, y: number, K: Rect): number => Math.hypot(Math.max(K.l - x, 0, x - K.r), Math.max(K.t - y, 0, y - K.b));
  const bars: MaskBar[] = [];

  for (const sx of [0, 1]) {
    const C = { x: sx ? W - 0.6 * t : 0.6 * t, y: H };
    const room = Math.min(...keep.map((K) => dist(C.x, C.y, K))) - w;
    const arcs: number[] = [];

    if (room > 2.2 * t) arcs.push(room);
    if (room - 2.8 * t > 1.6 * t) arcs.push(room - 2.8 * t);
    for (const rho of arcs) bars.push({ k: 'arc', C, rho, sx });
    let y0 = 0.3 * H;
    let y1 = H - (arcs[0] || 0);
    const xl = C.x - w;
    const xr = C.x + w;

    for (const K of keep) {
      if (K.r > xl && K.l < xr && K.b > y0 && K.t < y1) {
        if (K.t - y0 > y1 - K.b) y1 = K.t - w;
        else y0 = K.b + w;
      }
    }
    if (y1 - y0 > 3 * t) bars.push({ k: 'side', x: C.x, y0, y1, sx });
  }

  return { bars, t, bl, w, keep };
}

/** Points along a bar's centre line, for the clearance test. */
export function maskSamples(b: MaskBar, t: number): Pt[] {
  const out: Pt[] = [];

  for (let i = 0; i <= 24; i++) {
    const u = i / 24;

    if (b.k === 'arc') {
      const a = b.sx ? Math.PI + u * Math.PI / 2 : 1.5 * Math.PI + u * Math.PI / 2;

      out.push({ x: b.C.x + b.rho * Math.cos(a), y: b.C.y + b.rho * Math.sin(a) });
    } else {
      const bx = b.x + (b.sx ? -1 : 1) * 0.8 * t;
      const by = (b.y0 + b.y1) / 2;
      const v = 1 - u;

      out.push({ x: v * v * b.x + 2 * v * u * bx + u * u * b.x, y: v * v * b.y0 + 2 * v * u * by + u * u * b.y1 });
    }
  }

  return out;
}
