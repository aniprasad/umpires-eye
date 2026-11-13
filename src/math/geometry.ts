import type { Vec3 } from '../core/kinematics.ts';
import { MOUND_C, MOUND_H, MOUND_R, NEAR } from './constants';
import { clamp } from './util';

export interface Pt {
  x: number;
  y: number;
}

/** A projected point: screen x, y in px, camera depth d in ft, and px per ft at that depth (k). */
export interface Projected extends Pt {
  d: number;
  k: number;
}

export interface Rect {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** What any stance can put on screen with a viewport's lens: every dealt crossing, and the zone. */
export interface CamUnion {
  cross: Rect;
  zone: Rect;
}

export interface Cam {
  readonly eye: Vec3;
  readonly yaw: number;
  readonly F: number;
  readonly cx: number;
  readonly cy: number;
  readonly W: number;
  readonly H: number;
  c(p: Vec3): [number, number, number];
  pc(xc: number, yc: number, zc: number): Projected;
  p(p: Vec3): Projected;
  U?: CamUnion;
}

/** A camera from a fitted lens: it always knows the union of what its viewport's stances can show. */
export interface LensCam extends Cam {
  U: CamUnion;
}

/**
 * One pinhole: a level optical axis yawed toward the mound, and a shifted principal point (cx, cy), i.e. a crop of a
 * single pinhole image, like a shift lens.
 */
export function makeCam(eye: Vec3, yaw: number, F: number, cx: number, cy: number, W: number, H: number): Cam {
  const sn = Math.sin(yaw);
  const cs = Math.cos(yaw);
  const c = (p: Vec3): [number, number, number] => {
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;

    return [dx * cs - dy * sn, p.z - eye.z, dx * sn + dy * cs];
  };
  const pc = (xc: number, yc: number, zc: number): Projected => {
    const k = F / zc;

    return { x: cx + xc * k, y: cy - yc * k, d: zc, k };
  };
  const p = (q: Vec3): Projected => {
    const v = c(q);

    return pc(v[0], v[1], v[2]);
  };

  return { eye, yaw, F, cx, cy, W, H, c, pc, p };
}

export function withUnion(cam: Cam, U: CamUnion): LensCam {
  cam.U = U;

  return cam as LensCam;
}

/** Vertical field of view in degrees. */
export const vfovDeg = (cam: Cam): number => (Math.atan(cam.cy / cam.F) + Math.atan((cam.H - cam.cy) / cam.F)) * 180 / Math.PI;

/** Polygon projection with near-plane clipping in camera space. */
export function projPoly(cam: Cam, pts: readonly Vec3[]): Projected[] {
  const n = pts.length;
  const cs = pts.map((p) => cam.c(p));
  const out: Projected[] = [];

  for (let i = 0; i < n; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % n];
    const ai = a[2] >= NEAR;
    const bi = b[2] >= NEAR;

    if (ai) out.push(cam.pc(a[0], a[1], a[2]));
    if (ai !== bi) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);

      out.push(cam.pc(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), NEAR));
    }
  }

  return out;
}

/** The exact silhouette of a sphere: the tangent circle seen from the eye, projected. Null when the eye is inside. */
export function sphereOutline(cam: Cam, C: Vec3, r: number, n = 40): Projected[] | null {
  const E = cam.eye;
  const vx = C.x - E.x;
  const vy = C.y - E.y;
  const vz = C.z - E.z;
  const d2 = vx * vx + vy * vy + vz * vz;
  const d = Math.sqrt(d2);

  if (d <= r * 1.02) return null;
  const f = (r * r) / d2;
  const rho = r * Math.sqrt(1 - f);
  const ox = C.x - f * vx;
  const oy = C.y - f * vy;
  const oz = C.z - f * vz;
  const nx = vx / d;
  const ny = vy / d;
  const nz = vz / d;
  const ay = 0;
  let ax = 0;
  let az = 1;

  if (Math.abs(nz) > 0.9) {
    ax = 1;
    az = 0;
  }
  let ux = ay * nz - az * ny;
  let uy = az * nx - ax * nz;
  let uz = ax * ny - ay * nx;
  const ul = Math.hypot(ux, uy, uz);

  ux /= ul;
  uy /= ul;
  uz /= ul;
  const wx = ny * uz - nz * uy;
  const wy = nz * ux - nx * uz;
  const wz = nx * uy - ny * ux;
  const pts: Projected[] = [];

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ca = Math.cos(a) * rho;
    const sa = Math.sin(a) * rho;

    pts.push(cam.p({ x: ox + ux * ca + wx * sa, y: oy + uy * ca + wy * sa, z: oz + uz * ca + wz * sa }));
  }

  return pts;
}

export function centroid(sp: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;

  for (const p of sp) {
    x += p.x;
    y += p.y;
  }

  return { x: x / sp.length, y: y / sp.length };
}

/** Convex hull (monotone chain). */
export function hull<T extends Pt>(pts: readonly T[]): T[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);

  if (p.length < 3) return p;
  const cr = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: T[] = [];
  const up: T[] = [];

  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];

    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();

  return lo.concat(up);
}

export function ringPts(cx: number, cy: number, r: number, z = 0, n = 96): Vec3[] {
  const pts: Vec3[] = [];

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;

    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z });
  }

  return pts;
}

/** A flat band of width w along the ground from a to b. */
export function bandPts(ax: number, ay: number, bx: number, by: number, w: number, z = 0.004): Vec3[] {
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy);
  const nx = (-dy / L) * w / 2;
  const ny = (dx / L) * w / 2;

  return [
    { x: ax + nx, y: ay + ny, z },
    { x: bx + nx, y: by + ny, z },
    { x: bx - nx, y: by - ny, z },
    { x: ax - nx, y: ay - ny, z },
  ];
}

/** Ground height, including the mound's slope. */
export function groundZ(x: number, y: number): number {
  const r = Math.hypot(x - MOUND_C.x, y - MOUND_C.y);

  return MOUND_H * clamp((MOUND_R - r) / 7.5, 0, 1);
}
