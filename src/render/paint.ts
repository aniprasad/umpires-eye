import type { Vec3 } from '../core/kinematics.ts';
import { projPoly, type Cam, type Projected, type Pt } from '../math/geometry';
import { clamp, lerp } from '../math/util';

export type Paint = string | CanvasGradient | CanvasPattern;

/** [base, lit, shadow] */
export type Palette = readonly [string, string, string];

export function tracePoly(g: CanvasRenderingContext2D, sp: readonly Pt[]): void {
  g.moveTo(sp[0].x, sp[0].y);
  for (let i = 1; i < sp.length; i++) g.lineTo(sp[i].x, sp[i].y);
  g.closePath();
}

export function fillPoly(g: CanvasRenderingContext2D, cam: Cam, pts: readonly Vec3[], style: Paint): Projected[] | null {
  const sp = projPoly(cam, pts);

  if (sp.length < 3) return null;
  g.beginPath();
  tracePoly(g, sp);
  g.fillStyle = style;
  g.fill();

  return sp;
}

/** A tapered capsule between two screen circles (union-friendly, clockwise). */
export function capPath(g: CanvasRenderingContext2D, a: Pt, ra: number, b: Pt, rb: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);

  if (d < 1e-3 || d <= Math.abs(ra - rb)) {
    const [c, r] = ra >= rb ? [a, ra] : [b, rb];

    g.moveTo(c.x + r, c.y);
    g.arc(c.x, c.y, r, 0, Math.PI * 2);

    return;
  }
  const ang = Math.atan2(dy, dx);
  const off = Math.acos(clamp((ra - rb) / d, -1, 1));

  g.moveTo(a.x + ra * Math.cos(ang + off), a.y + ra * Math.sin(ang + off));
  g.arc(a.x, a.y, ra, ang + off, ang - off + Math.PI * 2);
  g.arc(b.x, b.y, rb, ang - off, ang + off);
  g.closePath();
}

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);

  return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',')})`;
}

/** Cylinder shading across a limb: the floods behind the plate light the side that faces up and toward us. */
export function cylFill(c: CanvasRenderingContext2D, A: Pt, ra: number, B: Pt, rb: number, pal: Palette, far: boolean): void {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const sg = nx * -0.5 + ny * -0.86 >= 0 ? 1 : -1;
  const r = Math.max(ra, rb) * 1.05;
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const tone = (h: string): string => (far ? mix(h, pal[2], 0.35) : h);
  const gr = c.createLinearGradient(mx - sg * nx * r, my - sg * ny * r, mx + sg * nx * r, my + sg * ny * r);

  gr.addColorStop(0, pal[2]);
  gr.addColorStop(0.48, tone(pal[0]));
  gr.addColorStop(0.8, tone(pal[1]));
  gr.addColorStop(1, tone(pal[0]));
  c.fillStyle = gr;
  c.beginPath();
  capPath(c, A, ra, B, rb);
  c.fill();
}

export function hullFill(c: CanvasRenderingContext2D, pts: readonly Pt[], round: number, pal: Palette, lightUp = 0.3): void {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;

  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const gr = c.createRadialGradient(x0 + w * 0.38, y0 + h * lightUp, 0, x0 + w * 0.45, y0 + h * 0.45, Math.max(w, h) * 0.85);

  gr.addColorStop(0, pal[1]);
  gr.addColorStop(0.45, pal[0]);
  gr.addColorStop(1, pal[2]);
  c.fillStyle = gr;
  c.strokeStyle = gr;
  c.lineJoin = 'round';
  c.lineWidth = round * 2;
  c.beginPath();
  tracePoly(c, pts);
  c.fill();
  c.stroke();
}
