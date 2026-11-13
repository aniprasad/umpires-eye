import type { Vec3 } from '../core/kinematics.ts';
import { dofBlur } from './dof';
import { sphereOutline, type Cam, type Projected, type Rect } from './geometry';
import type { Pitch } from './types';

/**
 * The photographic batter, keyed offline from the generated source still. Anchors are in batter-image pixels:
 * the helmet top, the mean sole line, the stance centre between the cleats and each cleat's centre. One image,
 * mirrored for lefties; his helmet top stands at `stance` × his listed height.
 */
export const BATTER_IMG = { top: 123, sole: 1424.5, footX: 404, backX: 72, frontX: 736, stance: 0.9 } as const;

export type BatterJoint =
  | 'heelB' | 'toeB' | 'heelF' | 'toeF' | 'ankB' | 'ankF' | 'knB' | 'knF' | 'hipB' | 'hipF' | 'waistB' | 'waistF'
  | 'shB' | 'shF' | 'neck' | 'head' | 'elB' | 'elF' | 'hands' | 'knob' | 'batTip';

export interface BatterRig {
  j: Record<BatterJoint, Vec3>;
  s: number;
  /** +1 when the plate is toward +x from the batter (a right-hander), -1 for a left-hander. */
  px: number;
  H: number;
  headR: number;
  bx: number;
  by: number;
}

/** A generic stance at true height in the correct box: a right-hander stands on -x (the catcher's left). */
export function batterRig(P: Pitch): BatterRig {
  const H = P.batter.heightFt;
  const s = H / 6.1;
  const px = P.batter.side === 'R' ? 1 : -1;
  const bx = -px * 2.75;
  const by = 1.2;
  const J = (a: number, b: number, f: number): Vec3 => ({ x: bx + px * a * s, y: by + b * s, z: f * H });
  const hands = J(0.64, -0.58, 0.75);
  const d = { a: -0.22, b: -0.48, z: 0.85 };
  const dl = Math.hypot(d.a, d.b, d.z);
  const along = (len: number): Vec3 => ({ x: hands.x + px * d.a / dl * len, y: hands.y + d.b / dl * len, z: hands.z + d.z / dl * len });
  const j: Record<BatterJoint, Vec3> = {
    heelB: J(-0.20, -1.10, 0.012), toeB: J(0.40, -1.00, 0.012),
    heelF: J(-0.18, 0.92, 0.012), toeF: J(0.42, 1.10, 0.012),
    ankB: J(-0.06, -1.04, 0.05), ankF: J(-0.04, 0.98, 0.05),
    knB: J(0.30, -0.80, 0.265), knF: J(0.33, 0.76, 0.265),
    hipB: J(-0.12, -0.38, 0.465), hipF: J(-0.06, 0.36, 0.465),
    waistB: J(0.02, -0.30, 0.58), waistF: J(0.08, 0.30, 0.58),
    shB: J(0.26, -0.64, 0.745), shF: J(0.42, 0.50, 0.732),
    neck: J(0.36, -0.04, 0.795), head: J(0.42, 0.06, 0.858),
    elB: J(0.08, -1.08, 0.705), elF: J(0.80, -0.10, 0.62),
    hands,
    knob: along(-0.25 * s), batTip: along(2.75 * s),
  };

  return { j, s, px, H, headR: 0.38 * s, bx, by };
}

export interface BatterPlacement {
  R: BatterRig;
  /** Screen px per image px. */
  s: number;
  flip: boolean;
  foot: Projected;
  X(u: number): number;
  Y(v: number): number;
}

/** The photo at true stance height on his spot in the box; with a level axis, verticals stay vertical. */
export function batterPlace(cam: Cam, P: Pitch): BatterPlacement {
  const R = batterRig(P);
  const B = BATTER_IMG;
  const foot = cam.p({ x: R.bx, y: R.by, z: 0 });
  const head = cam.p({ x: R.bx, y: R.by, z: R.H * B.stance });
  const s = (foot.y - head.y) / (B.sole - B.top);
  const flip = R.px < 0;

  return {
    R,
    s,
    flip,
    foot,
    X: (u) => foot.x + (flip ? -1 : 1) * (u - B.footX) * s,
    Y: (v) => foot.y + (v - B.sole) * s,
  };
}

/** The screen box of the batter's body, shoulders to knees: the reference the reveal teaches against. */
export function batterBody(cam: Cam, P: Pitch, photo: boolean): Rect {
  if (photo) {
    const L = batterPlace(cam, P);
    const xa = L.X(100);
    const xb = L.X(640);

    return { l: Math.min(xa, xb), r: Math.max(xa, xb), t: L.Y(300), b: L.Y(1130) };
  }
  const R = batterRig(P);
  const keys: BatterJoint[] = ['shB', 'shF', 'hipB', 'hipF', 'knB', 'knF', 'hands', 'elB', 'elF'];
  const pts = keys.map((k) => cam.p(R.j[k]));
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);

  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}

/** Depth of field across the stance: the near (back) side and the far (front) side, ft and px. */
export function batterDof(cam: Cam, P: Pitch): { dN: number; dF: number; sN: number; sF: number } {
  const R = batterRig(P);
  const d = (dy: number): number => cam.p({ x: R.bx, y: R.by + dy * R.s, z: R.H * 0.5 }).d;
  const dN = d(-1.1);
  const dF = d(1.1);

  return { dN, dF, sN: dofBlur(cam, dN), sF: dofBlur(cam, dF) };
}

/** The screen extent of the batter's helmet, brim included. */
export function headSpan(cam: Cam, R: BatterRig): Rect {
  const h = R.j.head;
  const pts: Projected[] = sphereOutline(cam, h, R.headR, 24) || [cam.p(h)];

  pts.push(cam.p({ x: h.x + R.px * 0.56 * R.s, y: h.y, z: h.z - 0.1 * R.s }));
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);

  return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
}
