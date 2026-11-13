import type { Vec3 } from '../core/kinematics.ts';
import { MID_Y, PLATE_FRONT_Y, PLATE_HALF, RUBBER_Y } from '../core/rules.ts';
import { EYE, MOUND_C, MOUND_H, MOUND_R, NEAR } from '../math/constants';
import { bandPts, groundZ, ringPts, type Cam } from '../math/geometry';
import { clamp } from '../math/util';
import { LAY, view, ctx2d } from './env';
import { withFilter } from './filter';
import { noise } from './noise';
import { fillPoly, mix, tracePoly } from './paint';

const COL = {
  dirtFar: '#8c5233',
  dirt: '#a8633b',
  dirtNear: '#b56e44',
  chalk: 'rgba(245,242,233,0.92)',
};

function grassStripes(g: CanvasRenderingContext2D, cam: Cam): void {
  const S2 = Math.SQRT2;

  for (let fam = 0; fam < 2; fam++) {
    for (let k = -18; k < 36; k++) {
      if ((k & 1) === 0) continue;
      const q0 = k * 15;
      const q1 = q0 + 15;
      const p0 = -60;
      const p1 = 560;
      const pts = [[p0, q0], [p1, q0], [p1, q1], [p0, q1]].map(([p, q]) => (fam === 0
        ? { x: (p - q) / S2, y: (p + q) / S2, z: 0 }
        : { x: (q - p) / S2, y: (p + q) / S2, z: 0 }));

      fillPoly(g, cam, pts, fam === 0 ? 'rgba(232,255,196,0.07)' : 'rgba(0,24,0,0.09)');
    }
  }
}

export function drawGround(g: CanvasRenderingContext2D, cam: Cam): void {
  const far = cam.p({ x: 0, y: 400, z: 0 }).y;
  const gg = g.createLinearGradient(0, far, 0, cam.H);

  gg.addColorStop(0, '#46733a');
  gg.addColorStop(0.06, '#4f863c');
  gg.addColorStop(0.3, '#5a9142');
  gg.addColorStop(1, '#447a35');
  const groundPts = [{ x: -2000, y: EYE.y + 0.3, z: 0 }, { x: 2000, y: EYE.y + 0.3, z: 0 }, { x: 2000, y: 400, z: 0 }, { x: -2000, y: 400, z: 0 }];
  const gsp = fillPoly(g, cam, groundPts, gg);

  if (gsp) {
    g.save();
    g.beginPath();
    tracePoly(g, gsp);
    g.clip();
    grassStripes(g, cam);
    g.restore();
  }
  const dg = g.createLinearGradient(0, far, 0, cam.H);

  dg.addColorStop(0, COL.dirtFar);
  dg.addColorStop(0.25, COL.dirt);
  dg.addColorStop(1, COL.dirtNear);
  // the infield skin: the 95 ft arc around the rubber
  const arc: Vec3[] = [];

  for (let i = 0; i <= 64; i++) {
    const th = (-80 + (160 * i) / 64) * Math.PI / 180;

    arc.push({ x: 95 * Math.sin(th), y: RUBBER_Y + 95 * Math.cos(th), z: 0 });
  }
  arc.push({ x: 0, y: 30, z: 0 });
  fillPoly(g, cam, arc, dg);
  // the infield grass square, inset so the base paths stay dirt
  const sq = [{ x: 0, y: 6.4, z: 0 }, { x: 57.3, y: 63.64, z: 0 }, { x: 0, y: 120.9, z: 0 }, { x: -57.3, y: 63.64, z: 0 }];
  const ssp = fillPoly(g, cam, sq, gg);

  if (ssp) {
    g.save();
    g.beginPath();
    tracePoly(g, ssp);
    g.clip();
    grassStripes(g, cam);
    g.restore();
  }
  // the home circle, base paths and base cut-outs
  fillPoly(g, cam, ringPts(0, MID_Y, 13), dg);
  for (const s of [-1, 1]) {
    fillPoly(g, cam, bandPts(0, 0, s * 63.64, 63.64, 6, 0), dg);
    fillPoly(g, cam, ringPts(s * 62.6, 63.4, 12, 0, 56), dg);
  }
}

export function drawMound(g: CanvasRenderingContext2D, cam: Cam): void {
  const N = 10;

  // a soft contact shadow where the mound meets the grass
  fillPoly(g, cam, ringPts(MOUND_C.x, MOUND_C.y, MOUND_R + 0.6, 0, 72), 'rgba(40,24,14,0.35)');
  for (let i = 0; i <= N; i++) {
    const r = MOUND_R - i * (7.5 / N);
    const h = MOUND_H * clamp((MOUND_R - r) / 7.5, 0, 1);

    fillPoly(g, cam, ringPts(MOUND_C.x, MOUND_C.y, r, h, 72), mix('#8d5131', '#c27c4b', Math.pow(i / N, 0.8)));
  }
  const z = MOUND_H + 0.02;

  fillPoly(g, cam, [{ x: -1, y: 60.5, z }, { x: 1, y: 60.5, z }, { x: 1, y: 61, z }, { x: -1, y: 61, z }], '#f4f1e8');
}

function drawChalk(g: CanvasRenderingContext2D, cam: Cam): void {
  const W3 = 0.25;
  const C1 = COL.chalk;

  for (const s of [-1, 1]) {
    fillPoly(g, cam, bandPts(s * 3.71, 3.71, s * 300, 300, 0.3), C1);
    const xi = s * 1.208;
    const xo = s * 5.208;
    const yb = -2.29;
    const yf = 3.71;

    fillPoly(g, cam, bandPts(xi, yb, xi, yf, W3), C1);
    fillPoly(g, cam, bandPts(xo, yb, xo, yf, W3), C1);
    fillPoly(g, cam, bandPts(xi - s * W3 / 2, yf, xo + s * W3 / 2, yf, W3), C1);
    fillPoly(g, cam, bandPts(xi - s * W3 / 2, yb, xo + s * W3 / 2, yb, W3), C1);
    const bx = s * 63.64;
    const by = 63.64;
    const b = 1.06;

    fillPoly(g, cam, [{ x: bx, y: by, z: 0.05 }, { x: bx - s * b, y: by + b, z: 0.05 }, { x: bx - s * 2 * b, y: by, z: 0.05 }, { x: bx - s * b, y: by - b, z: 0.05 }], '#f6f3ea');
  }
  fillPoly(g, cam, [{ x: 0, y: 127.28, z: 0.05 }, { x: 1.06, y: 128.34, z: 0.05 }, { x: 0, y: 129.4, z: 0.05 }, { x: -1.06, y: 128.34, z: 0.05 }], '#f6f3ea');
}

/** Home plate: whitened rubber, kept crisp, because it's the reference the eye uses. */
export function drawPlate(g: CanvasRenderingContext2D, cam: Cam): void {
  const z = 0.02;

  fillPoly(g, cam, [{ x: -PLATE_HALF, y: PLATE_FRONT_Y, z }, { x: PLATE_HALF, y: PLATE_FRONT_Y, z }, { x: PLATE_HALF, y: MID_Y, z }, { x: 0, y: 0, z }, { x: -PLATE_HALF, y: MID_Y, z }], '#f6f3ea');
}

/** Chalk is laid on its own sheet, grained (fine dropouts, coarse patchiness, soft edges), then put down on the dirt. */
export function chalkSheet(g: CanvasRenderingContext2D, cam: Cam): void {
  const N = noise();
  const C = LAY.sC;
  const c = ctx2d(C);
  const dpr = view.dpr;

  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.filter = 'none';
  c.clearRect(0, 0, C.width, C.height);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChalk(c, cam);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-out';
  c.globalAlpha = 0.5;
  c.fillStyle = c.createPattern(N.grain, 'repeat') as CanvasPattern;
  c.fillRect(0, 0, C.width, C.height);
  c.globalAlpha = 0.32;
  c.fillStyle = c.createPattern(N.patchy, 'repeat') as CanvasPattern;
  c.fillRect(0, 0, C.width, C.height);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  withFilter(g, `blur(${(0.4 * dpr).toFixed(2)}px)`, (k) => k.drawImage(C, 0, 0));
  g.restore();
}

export function groundTexture(g: CanvasRenderingContext2D, wallY: number): void {
  const N = noise();

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const y0 = Math.max(0, Math.floor(wallY * view.dpr));
  const w = g.canvas.width;
  const h = g.canvas.height - y0;

  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.1;
  g.fillStyle = g.createPattern(N.fine, 'repeat') as CanvasPattern;
  g.fillRect(0, y0, w, h);
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = 0.16;
  g.fillStyle = g.createPattern(N.coarse, 'repeat') as CanvasPattern;
  g.fillRect(0, y0, w, h);
  g.restore();
}

export function groundLight(g: CanvasRenderingContext2D, cam: Cam, wallY: number): void {
  g.save();
  // night: the field steps down a touch so the pools of light read
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = 'rgb(200,200,210)';
  g.fillRect(0, wallY, cam.W, cam.H - wallY);
  // pools of light from the towers: overlapping ellipses on the ground, brightest on the mound and the plate
  g.globalCompositeOperation = 'screen';
  const pool = (x: number, y: number, r: number, a: number): void => {
    const c = cam.p({ x, y, z: 0 });
    const ex = cam.p({ x: x + r, y, z: 0 });
    const ey = cam.p({ x, y: y + r, z: 0 });

    if (c.d < 2 || ey.d < 2) return;
    g.save();
    g.transform(ex.x - c.x, ex.y - c.y, ey.x - c.x, ey.y - c.y, c.x, c.y);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);

    rg.addColorStop(0, `rgba(255,236,204,${a})`);
    rg.addColorStop(0.5, `rgba(255,236,204,${(a * 0.45).toFixed(3)})`);
    rg.addColorStop(1, 'rgba(255,236,204,0)');
    g.fillStyle = rg;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  };

  pool(0, 60, 24, 0.2);
  pool(-40, 84, 34, 0.12);
  pool(40, 84, 34, 0.12);
  pool(0, 128, 42, 0.1);
  pool(-130, 235, 95, 0.08);
  pool(130, 235, 95, 0.08);
  pool(0, 300, 110, 0.06);
  const pc = cam.p({ x: 0, y: 3, z: 0 });
  const rp = Math.max(cam.W, cam.H) * 0.62;

  g.save();
  g.translate(pc.x, pc.y);
  g.scale(1, 0.45);
  const pg = g.createRadialGradient(0, 0, 0, 0, 0, rp);

  pg.addColorStop(0, 'rgba(255,238,210,0.2)');
  pg.addColorStop(0.5, 'rgba(255,238,210,0.07)');
  pg.addColorStop(1, 'rgba(255,238,210,0)');
  g.fillStyle = pg;
  g.fillRect(-rp, -rp, 2 * rp, 2 * rp);
  g.restore();
  g.globalCompositeOperation = 'source-over';
  const hz = g.createLinearGradient(0, wallY - 24, 0, wallY + 28);

  hz.addColorStop(0, 'rgba(110,130,140,0)');
  hz.addColorStop(0.5, 'rgba(110,130,140,0.12)');
  hz.addColorStop(1, 'rgba(110,130,140,0)');
  g.fillStyle = hz;
  g.fillRect(0, wallY - 24, cam.W, 52);
  const fg = g.createLinearGradient(0, cam.H * 0.72, 0, cam.H);

  fg.addColorStop(0, 'rgba(0,0,0,0)');
  fg.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = fg;
  g.fillRect(0, cam.H * 0.72, cam.W, cam.H * 0.28);
  const vg = g.createRadialGradient(cam.W / 2, cam.H * 0.46, Math.min(cam.W, cam.H) * 0.38, cam.W / 2, cam.H * 0.46, Math.hypot(cam.W, cam.H) * 0.62);

  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = vg;
  g.fillRect(0, 0, cam.W, cam.H);
  // the floods above the frame veil its top edge
  g.globalCompositeOperation = 'screen';
  const vh = Math.max(70, wallY * 1.15);
  const vt = g.createLinearGradient(0, 0, 0, vh);

  vt.addColorStop(0, 'rgba(255,240,214,0.13)');
  vt.addColorStop(1, 'rgba(255,240,214,0)');
  g.fillStyle = vt;
  g.fillRect(0, 0, cam.W, vh);
  g.restore();
}

/** Light towers (x, y, height ft): four beyond the outfield, two behind home plate (out of view). */
const TOWERS: readonly (readonly [number, number, number])[] = [[-330, 280, 130], [-170, 430, 120], [170, 430, 120], [330, 280, 130], [-250, -150, 140], [250, -150, 140]];

/** Soft multi-tower shadows: one faint tapered shadow per tower, laid on the ground (mound slope included). */
export function castShadows(g: CanvasRenderingContext2D, cam: Cam, fx: number, fy: number, h: number, alpha: number): void {
  for (const [tx, ty, tz] of TOWERS) {
    let dx = fx - tx;
    let dy = fy - ty;
    const dist = Math.hypot(dx, dy);

    dx /= dist;
    dy /= dist;
    const L = Math.min(h * dist / Math.max(tz - h, 1), 4.2 * h);
    const nx = -dy;
    const ny = dx;
    const w0 = 0.5;
    const w1 = 0.95;
    const at = (x: number, y: number): Vec3 => ({ x, y, z: groundZ(x, y) + 0.015 });
    const pts = [at(fx + nx * w0, fy + ny * w0), at(fx + dx * L + nx * w1, fy + dy * L + ny * w1), at(fx + dx * L - nx * w1, fy + dy * L - ny * w1), at(fx - nx * w0, fy - ny * w0)];
    const a = cam.p(at(fx, fy));
    const b = cam.p(at(fx + dx * L * 0.7, fy + dy * L * 0.7));

    if (a.d < NEAR || b.d < NEAR) continue;
    const lg = g.createLinearGradient(a.x, a.y, b.x, b.y);

    lg.addColorStop(0, `rgba(12,7,4,${alpha})`);
    lg.addColorStop(1, 'rgba(12,7,4,0)');
    fillPoly(g, cam, pts, lg);
  }
}
