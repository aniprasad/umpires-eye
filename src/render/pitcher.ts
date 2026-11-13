import { BALL_R } from '../core/rules.ts';
import { groundZ, hull, ringPts, type Cam, type Projected } from '../math/geometry';
import type { PreparedPitch } from '../math/kinematics';
import { pitcherPose, type PitcherJoint } from '../math/pitcher';
import { lerp } from '../math/util';
import { ctx2d, view } from './env';
import { castShadows } from './field';
import { cylFill, fillPoly, hullFill, type Palette } from './paint';

/** The shaded figure's palette: one generic road uniform, no marks. */
const PCOL = {
  jersey: ['#a9ada6', '#d8dad3', '#676b65'],
  pants: ['#a2a59e', '#d2d4cd', '#61655e'],
  skin: ['#ad8264', '#d6a888', '#6e4c39'],
  trim: ['#1e2840', '#3a4a70', '#0c111c'],
  shoe: ['#15181d', '#353a43', '#07080a'],
  glove: ['#4d311e', '#80573a', '#22160c'],
} as const satisfies Record<string, Palette>;

type PalKey = keyof typeof PCOL;

type Part =
  | { t: 'cap'; A: Projected; B: Projected; ra: number; rb: number; col: PalKey; d: number }
  | { t: 'hull'; pts: Projected[]; col: PalKey; d: number; round: number }
  | { t: 'dot'; c: Projected; r: number; col: PalKey; d: number };

const FIG = document.createElement('canvas');

/** The pitcher: in the focal plane, so he's drawn sharp, every frame, on his own small sheet. */
export function drawPitcher(g: CanvasRenderingContext2D, cam: Cam, P: PreparedPitch, s: number): void {
  const dpr = view.dpr;
  const J = pitcherPose(P, s);
  const q = {} as Record<PitcherJoint, Projected>;

  for (const k in J) q[k as PitcherJoint] = cam.p(J[k as PitcherJoint]);
  // shadows from every tower laid on the mound, then a tight contact shadow
  const fx = (J.tFt.x + J.gFt.x) / 2;
  const fy = (J.tFt.y + J.gFt.y) / 2;

  castShadows(g, cam, fx, fy, 6.1, 0.15);
  fillPoly(g, cam, ringPts(fx, fy, 0.75 + Math.abs(J.tFt.y - J.gFt.y) * 0.22, groundZ(fx, fy) + 0.012, 32), 'rgba(30,16,8,0.34)');
  const parts: Part[] = [];
  const cap = (A: Projected, B: Projected, ra: number, rb: number, col: PalKey, dz = 0): void => {
    parts.push({ t: 'cap', A, B, ra: ra * A.k, rb: rb * B.k, col, d: (A.d + B.d) / 2 + dz });
  };
  const at = (a: PitcherJoint, b: PitcherJoint, f: number): Projected => ({
    x: lerp(q[a].x, q[b].x, f),
    y: lerp(q[a].y, q[b].y, f),
    k: lerp(q[a].k, q[b].k, f),
    d: lerp(q[a].d, q[b].d, f),
  });

  for (const sd of ['t', 'g'] as const) {
    cap(q[`${sd}Hip` as const], q[`${sd}Kn` as const], 0.29, 0.21, 'pants');
    cap(q[`${sd}Kn` as const], q[`${sd}Ft` as const], 0.2, 0.13, 'pants');
    // high socks
    cap(at(`${sd}Kn` as const, `${sd}Ft` as const, 0.5), q[`${sd}Ft` as const], 0.15, 0.12, 'trim', -0.01);
  }
  // an undershirt sleeve and a bare forearm on the throwing side
  cap(q.tSh, q.tEl, 0.165, 0.13, 'trim');
  cap(q.tEl, q.tHa, 0.12, 0.085, 'skin');
  cap(q.gSh, q.gEl, 0.165, 0.13, 'trim');
  cap(q.gEl, q.gHa, 0.125, 0.1, 'trim');
  parts.push({ t: 'hull', pts: hull([q.tSh, q.gSh, q.gHip, q.tHip, q.neck]), col: 'jersey', d: (q.tSh.d + q.gSh.d + q.tHip.d + q.gHip.d) / 4, round: 0.17 * q.pel.k });
  cap(q.tHip, q.gHip, 0.3, 0.3, 'pants', 0.02);
  const up = (p: Projected, ft: number): Projected => ({ x: p.x, y: p.y - ft * p.k, k: p.k, d: p.d });

  // the belt
  cap(up(q.tHip, 0.24), up(q.gHip, 0.24), 0.065, 0.065, 'trim', -0.03);
  cap(q.neck, q.head, 0.11, 0.11, 'skin');
  parts.push({ t: 'dot', c: q.tFt, r: 0.17 * q.tFt.k, col: 'shoe', d: q.tFt.d });
  parts.push({ t: 'dot', c: q.gFt, r: 0.17 * q.gFt.k, col: 'shoe', d: q.gFt.d });
  parts.push({ t: 'dot', c: q.gHa, r: 0.36 * q.gHa.k, col: 'glove', d: q.gHa.d - 0.02 });
  parts.sort((a, b) => b.d - a.d);
  // the figure goes on its own small sheet, so the floodlight falloff touches only him
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;

  for (const k in q) {
    const p = q[k as PitcherJoint];

    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const pad = 0.7 * q.pel.k + 4;

  x0 = Math.floor(x0 - pad);
  y0 = Math.floor(y0 - pad);
  x1 = Math.ceil(x1 + pad);
  y1 = Math.ceil(y1 + pad);
  const cw = Math.ceil((x1 - x0) * dpr);
  const ch = Math.ceil((y1 - y0) * dpr);

  if (FIG.width < cw || FIG.height < ch) {
    FIG.width = Math.max(FIG.width, cw);
    FIG.height = Math.max(FIG.height, ch);
  }
  const c = ctx2d(FIG);

  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, cw + 2, ch + 2);
  c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
  const ref = q.pel.d;

  for (const p of parts) {
    const pal = PCOL[p.col];
    const far = p.d > ref + 0.25;

    if (p.t === 'cap') cylFill(c, p.A, p.ra, p.B, p.rb, pal, far);
    else if (p.t === 'hull') hullFill(c, p.pts, p.round, pal, 0.22);
    else {
      const rg = c.createRadialGradient(p.c.x - p.r * 0.35, p.c.y - p.r * 0.4, 0, p.c.x, p.c.y, p.r * 1.1);

      rg.addColorStop(0, pal[1]);
      rg.addColorStop(0.55, pal[0]);
      rg.addColorStop(1, pal[2]);
      c.fillStyle = rg;
      c.beginPath();
      c.arc(p.c.x, p.c.y, p.r, 0, Math.PI * 2);
      c.fill();
    }
  }
  // cloth: knee creases and a jersey fold from the throwing shoulder toward the far hip
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(38,38,34,0.32)';
  for (const sd of ['t', 'g'] as const) {
    const K = q[`${sd}Kn` as const];
    const H0 = q[`${sd}Hip` as const];
    const dx = K.x - H0.x;
    const dy = K.y - H0.y;
    const L = Math.hypot(dx, dy) || 1;
    const r = 0.17 * K.k;

    c.lineWidth = Math.max(0.6, 0.03 * K.k);
    c.beginPath();
    c.moveTo(K.x - (dy / L) * r, K.y + (dx / L) * r - 0.06 * K.k);
    c.lineTo(K.x + (dy / L) * r * 0.6, K.y - (dx / L) * r * 0.6 - 0.02 * K.k);
    c.stroke();
  }
  c.lineWidth = Math.max(0.6, 0.03 * q.pel.k);
  c.beginPath();
  c.moveTo(q.tSh.x, q.tSh.y + 0.2 * q.tSh.k);
  c.quadraticCurveTo(q.pel.x, q.pel.y - 0.6 * q.pel.k, q.gHip.x, q.gHip.y - 0.35 * q.gHip.k);
  c.stroke();
  // the head: shaded, a navy cap with its brim toward the plate and a brim shadow across the eyes
  const hc = q.head;
  const hr = 0.33 * hc.k;
  const hg = c.createRadialGradient(hc.x - hr * 0.35, hc.y - hr * 0.1, hr * 0.1, hc.x, hc.y, hr * 1.1);

  hg.addColorStop(0, PCOL.skin[1]);
  hg.addColorStop(0.6, PCOL.skin[0]);
  hg.addColorStop(1, PCOL.skin[2]);
  c.fillStyle = hg;
  c.beginPath();
  c.arc(hc.x, hc.y, hr, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.beginPath();
  c.arc(hc.x, hc.y, hr * 1.07, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = 'rgba(40,22,14,0.4)';
  c.fillRect(hc.x - 2 * hr, hc.y - 0.2 * hr, 4 * hr, 0.5 * hr);
  const cg = c.createLinearGradient(hc.x - hr, hc.y - hr, hc.x + hr, hc.y);

  cg.addColorStop(0, PCOL.trim[1]);
  cg.addColorStop(0.5, PCOL.trim[0]);
  cg.addColorStop(1, PCOL.trim[2]);
  c.fillStyle = cg;
  c.fillRect(hc.x - 2 * hr, hc.y - 2 * hr, 4 * hr, 1.78 * hr);
  c.restore();
  c.fillStyle = PCOL.trim[2];
  c.beginPath();
  c.ellipse(hc.x, hc.y - 0.16 * hr, hr * 1.08, hr * 0.24, 0, 0, Math.PI * 2);
  c.fill();
  // floodlight falloff: the shoulders catch the light, the legs sink toward the mound
  c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
  c.globalCompositeOperation = 'source-atop';
  const fg = c.createLinearGradient(0, q.head.y - hr, 0, Math.max(q.tFt.y, q.gFt.y));

  fg.addColorStop(0, 'rgba(255,242,220,0.12)');
  fg.addColorStop(0.42, 'rgba(0,0,0,0)');
  fg.addColorStop(1, 'rgba(12,9,6,0.34)');
  c.fillStyle = fg;
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.globalCompositeOperation = 'source-over';
  g.drawImage(FIG, 0, 0, cw, ch, x0, y0, cw / dpr, ch / dpr);
  // the ball rides in the throwing hand from the hand break until release
  if (s >= -0.42 && s < 0) {
    const bq = q.tHa;

    g.beginPath();
    g.arc(bq.x, bq.y, Math.max(BALL_R * bq.k, 0.8), 0, Math.PI * 2);
    g.fillStyle = '#fbfaf5';
    g.fill();
  }
}
