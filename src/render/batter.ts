import { NEAR } from '../math/constants';
import { batterDof, batterPlace, batterRig, BATTER_IMG, type BatterRig } from '../math/batter';
import { dofBlur } from '../math/dof';
import { centroid, hull, ringPts, sphereOutline, type Cam, type Projected } from '../math/geometry';
import type { Pitch, Vec3 } from '../math/types';
import { ctx2d, IMG, LAY, view } from './env';
import { castShadows } from './field';
import { withFilter } from './filter';
import { cylFill, fillPoly, hullFill, tracePoly, type Palette } from './paint';

const BATTER_PAL = {
  jersey: ['#26355a', '#40568a', '#101829'],
  pants: ['#80868d', '#adb3ba', '#454a51'],
  belt: ['#0f141c', '#2a3140', '#07090c'],
  shoe: ['#1b1e24', '#3d424b', '#08090b'],
  glove: ['#2c2f35', '#545962', '#121418'],
  bat: ['#5c4129', '#96724f', '#2c1d11'],
  helmet: ['#171d29', '#4d5a76', '#06080b'],
  neck: ['#8f6a52', '#b88f73', '#573f30'],
} as const satisfies Record<string, Palette>;

type PalKey = keyof typeof BATTER_PAL;

type Part =
  | { t: 'cap'; A: Projected; B: Projected; ra: number; rb: number; col: PalKey; d: number }
  | { t: 'hull'; pts: Projected[]; col: PalKey; d: number; round: number }
  | { t: 'poly'; pts: Projected[]; col: PalKey; d: number };

/** The procedural figure: tapered limbs and hulls, depth-sorted far to near. */
function batterParts(cam: Cam, P: Pitch): { parts: Part[]; rig: BatterRig } {
  const R = batterRig(P);
  const j = R.j;
  const s = R.s;
  const px = R.px;
  const H = R.H;
  const parts: Part[] = [];
  const cap = (a: Vec3, b: Vec3, ra: number, rb: number, col: PalKey): void => {
    const A = cam.p(a);
    const B = cam.p(b);

    parts.push({ t: 'cap', A, B, ra: ra * s * A.k, rb: rb * s * B.k, col, d: (A.d + B.d) / 2 });
  };
  const blob = (ws: Vec3[], col: PalKey, dBias = 0): void => {
    const sp = ws.map((w) => cam.p(w));

    parts.push({ t: 'hull', pts: hull(sp), col, d: sp.reduce((m, q) => m + q.d, 0) / sp.length + dBias, round: 0.07 * s * sp[0].k });
  };
  const off = (p: Vec3, a: number, dz = 0): Vec3 => ({ x: p.x + px * a * s, y: p.y, z: p.z + dz });

  // the chest (shoulders to waist, tapering), then the pelvis below the belt line
  blob([off(j.shB, 0.30), off(j.shB, -0.32), off(j.shF, 0.28), off(j.shF, -0.30),
    off(j.waistB, 0.24), off(j.waistB, -0.27), off(j.waistF, 0.24), off(j.waistF, -0.26)], 'jersey');
  blob([off(j.waistB, 0.24), off(j.waistB, -0.28), off(j.waistF, 0.24), off(j.waistF, -0.27),
    off(j.hipB, 0.24, -0.04 * H), off(j.hipB, -0.33, -0.03 * H), off(j.hipF, 0.22, -0.04 * H), off(j.hipF, -0.30, -0.03 * H)], 'pants', 0.05);
  cap(j.hipB, j.knB, 0.28, 0.21, 'pants');
  cap(j.knB, j.ankB, 0.2, 0.13, 'pants');
  cap(j.hipF, j.knF, 0.28, 0.21, 'pants');
  cap(j.knF, j.ankF, 0.2, 0.13, 'pants');
  cap(j.heelB, j.toeB, 0.1, 0.08, 'shoe');
  cap(j.heelF, j.toeF, 0.1, 0.08, 'shoe');
  cap(j.shB, j.elB, 0.17, 0.13, 'jersey');
  cap(j.elB, j.hands, 0.13, 0.11, 'glove');
  cap(j.shF, j.elF, 0.17, 0.13, 'jersey');
  cap(j.elF, j.hands, 0.13, 0.11, 'glove');
  cap(j.neck, j.head, 0.19, 0.19, 'neck');
  cap(j.knob, j.batTip, 0.05, 0.105, 'bat');
  const hq = cam.p(j.head);

  parts.push({ t: 'poly', pts: sphereOutline(cam, j.head, R.headR, 48) || [hq], col: 'helmet', d: hq.d - 0.4 });
  // the helmet brim, toward the plate
  const br = [
    off(j.head, 0.18, -0.06 * s),
    off(j.head, 0.52, -0.1 * s),
    off({ x: j.head.x, y: j.head.y + 0.2 * s, z: j.head.z }, 0.46, -0.1 * s),
    off({ x: j.head.x, y: j.head.y - 0.2 * s, z: j.head.z }, 0.42, -0.1 * s),
  ];

  blob(br, 'helmet', -0.45);
  parts.sort((a, b) => b.d - a.d);

  return { parts, rig: R };
}

/** A cleared work sheet with an identity transform and no filter. */
function sheet(C: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = ctx2d(C);

  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.filter = 'none';
  c.clearRect(0, 0, C.width, C.height);

  return c;
}

/**
 * The batter photo at true stance height on his spot in the box, graded to the night, rim-lit by the towers, then
 * defocused by the scene's own lens (stronger toward the near, back side of the stance).
 */
function drawBatterPhoto(g: CanvasRenderingContext2D, cam: Cam, P: Pitch): void {
  const img = IMG.bat;
  const B = BATTER_IMG;
  const L = batterPlace(cam, P);
  const R = L.R;
  const dpr = view.dpr;
  const w = img.naturalWidth * L.s;
  const h = img.naturalHeight * L.s;
  const x0 = L.flip ? L.X(img.naturalWidth) : L.X(0);
  const y0 = L.Y(0);
  const put = (c: CanvasRenderingContext2D, dx = 0, dy = 0): void => {
    if (!L.flip) {
      c.drawImage(img, x0 + dx, y0 + dy, w, h);

      return;
    }
    c.save();
    c.translate(x0 + w + dx, y0 + dy);
    c.scale(-1, 1);
    c.drawImage(img, 0, 0, w, h);
    c.restore();
  };

  // soft shadows from every tower and a contact shadow, at the blur of the ground under him
  g.save();
  withFilter(g, `blur(${(Math.max(2, dofBlur(cam, L.foot.d)) * dpr).toFixed(1)}px)`, (c) => {
    castShadows(c, cam, R.bx, R.by, R.H * 0.92, 0.12);
    fillPoly(c, cam, ringPts(R.bx, R.by, 1.5 * R.s, 0.01, 48), 'rgba(5,7,9,0.45)');
  });
  g.restore();
  // 1) graded to the night: darker, cooler and flatter than the studio still
  const ax = sheet(LAY.sA);

  ax.setTransform(dpr, 0, 0, dpr, 0, 0);
  withFilter(ax, 'brightness(0.72) contrast(1.07) saturate(0.84)', (c) => put(c));
  ax.globalCompositeOperation = 'source-atop';
  // the floodlight falloff
  const lg = ax.createLinearGradient(0, L.Y(B.top), 0, L.Y(B.sole));

  lg.addColorStop(0, 'rgba(255,232,200,0.10)');
  lg.addColorStop(0.4, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(3,5,9,0.5)');
  ax.fillStyle = lg;
  ax.fillRect(0, 0, cam.W, cam.H);
  ax.fillStyle = 'rgba(20,34,60,0.12)';
  ax.fillRect(0, 0, cam.W, cam.H);
  // 2) warm rims from the towers above the frame: the light-facing band of the silhouette, the outer side strongest,
  // wide enough to survive the defocus
  const out = L.flip ? -1 : 1;
  const k = Math.max(4, 20 * L.s);
  const rims: [number, number, number, string][] = [[-0.55 * out, -0.84, 0.8, '255,190,128'], [0.6 * out, -0.8, 0.5, '255,214,168']];

  for (const [lx, ly, a, col] of rims) {
    const bc = sheet(LAY.sB);

    bc.setTransform(dpr, 0, 0, dpr, 0, 0);
    put(bc);
    bc.globalCompositeOperation = 'source-in';
    bc.fillStyle = `rgb(${col})`;
    bc.fillRect(0, 0, cam.W, cam.H);
    bc.globalCompositeOperation = 'destination-out';
    put(bc, -lx * k, -ly * k);
    ax.save();
    ax.setTransform(1, 0, 0, 1, 0, 0);
    ax.globalCompositeOperation = 'screen';
    ax.globalAlpha = a;
    ax.drawImage(LAY.sB, 0, 0);
    ax.restore();
  }
  ax.globalCompositeOperation = 'source-over';
  // 3) depth of field: the near (back) and far (front) blurs cross-faded across the stance, added premultiplied
  const D = batterDof(cam, P);
  const xN = L.X(B.backX) * dpr;
  const xF = L.X(B.frontX) * dpr;
  const level = (C: HTMLCanvasElement, sig: number, a0: number, a1: number): CanvasRenderingContext2D => {
    const c = sheet(C);

    withFilter(c, `blur(${(sig * dpr).toFixed(1)}px)`, (q) => q.drawImage(LAY.sA, 0, 0));
    c.globalCompositeOperation = 'destination-in';
    const m = c.createLinearGradient(xN, 0, xF, 0);

    m.addColorStop(0, `rgba(0,0,0,${a0})`);
    m.addColorStop(1, `rgba(0,0,0,${a1})`);
    c.fillStyle = m;
    c.fillRect(0, 0, C.width, C.height);
    c.globalCompositeOperation = 'source-over';

    return c;
  };
  const far = level(LAY.sB, D.sF, 0, 1);

  level(LAY.sC, D.sN, 1, 0);
  far.globalCompositeOperation = 'lighter';
  far.drawImage(LAY.sC, 0, 0);
  far.globalCompositeOperation = 'source-over';
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(LAY.sB, 0, 0);
  g.restore();
}

/** The batter: the photo, or the procedural figure if the photo didn't load. */
export function drawBatter(g: CanvasRenderingContext2D, cam: Cam, P: Pitch): void {
  if (IMG.bat.naturalWidth) {
    drawBatterPhoto(g, cam, P);

    return;
  }
  const { parts, rig } = batterParts(cam, P);
  const j = rig.j;
  const fx = (j.ankB.x + j.ankF.x) / 2;
  const fy = (j.ankB.y + j.ankF.y) / 2;
  const dpr = view.dpr;

  // soft shadows from every tower, and a contact shadow under the stance
  g.save();
  withFilter(g, `blur(${Math.max(2, 0.008 * cam.F).toFixed(1)}px)`, (c) => {
    castShadows(c, cam, fx, fy, rig.H * 0.92, 0.11);
    fillPoly(c, cam, ringPts(fx, fy, 1.5 * rig.s, 0.01, 48), 'rgba(5,7,9,0.42)');
  });
  g.restore();
  const A = LAY.sA;
  const ax = sheet(A);

  ax.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of parts) {
    const pal = BATTER_PAL[p.col];

    if (p.t === 'cap') cylFill(ax, p.A, p.ra, p.B, p.rb, pal, false);
    else if (p.t === 'hull') hullFill(ax, p.pts, p.round, pal, 0.16);
    else {
      // the helmet shell: glossy, with one specular from the floods
      const c = centroid(p.pts);
      let r = 0;

      for (const q of p.pts) r = Math.max(r, Math.hypot(q.x - c.x, q.y - c.y));
      const hg = ax.createRadialGradient(c.x - r * 0.3, c.y - r * 0.35, r * 0.05, c.x, c.y, r * 1.05);

      hg.addColorStop(0, pal[1]);
      hg.addColorStop(0.35, pal[0]);
      hg.addColorStop(1, pal[2]);
      ax.fillStyle = hg;
      ax.beginPath();
      tracePoly(ax, p.pts);
      ax.fill();
      ax.fillStyle = 'rgba(220,230,245,0.28)';
      ax.beginPath();
      ax.ellipse(c.x - r * 0.32, c.y - r * 0.42, r * 0.28, r * 0.12, -0.5, 0, Math.PI * 2);
      ax.fill();
    }
  }
  // cloth: knee creases, a crease down the front thigh, folds across the jersey back above the belt
  const off = (p: Vec3, a: number, dz = 0): Vec3 => ({ x: p.x + rig.px * a * rig.s, y: p.y, z: p.z + dz });
  const crease = (c: CanvasRenderingContext2D, pts: Vec3[], w: number, a: number): void => {
    const sp = pts.map((p) => cam.p(p));

    if (sp.some((q) => q.d < NEAR)) return;
    c.beginPath();
    c.moveTo(sp[0].x, sp[0].y);
    if (sp.length === 3) c.quadraticCurveTo(sp[1].x, sp[1].y, sp[2].x, sp[2].y);
    else c.lineTo(sp[1].x, sp[1].y);
    c.lineWidth = Math.max(0.8, w * sp[0].k);
    c.strokeStyle = `rgba(14,16,20,${a})`;
    c.lineCap = 'round';
    c.stroke();
  };

  ax.save();
  withFilter(ax, `blur(${Math.max(0.6, 0.0016 * cam.F).toFixed(2)}px)`, (c) => {
    for (const K of [j.knB, j.knF]) crease(c, [off(K, -0.16, 0.05), off(K, 0.02, -0.02), off(K, 0.18, 0.04)], 0.035, 0.42);
    crease(c, [off(j.hipF, 0.1, -0.15), off(j.knF, 0.12, 0.2)], 0.025, 0.25);
    crease(c, [off(j.shB, -0.05, -0.35), off(j.waistB, 0.02, 0.35), off(j.waistF, -0.1, 0.12)], 0.03, 0.3);
    crease(c, [off(j.waistB, -0.15, 0.08), off(j.waistF, -0.05, 0.1)], 0.028, 0.32);
  });
  ax.restore();
  // floodlight falloff: lit shoulders, legs sinking into the dark of the box
  const yTop = cam.p({ x: j.head.x, y: j.head.y, z: rig.H }).y;
  const yBot = cam.p(j.ankF).y;

  ax.globalCompositeOperation = 'source-atop';
  const lg = ax.createLinearGradient(0, yTop, 0, yBot);

  lg.addColorStop(0, 'rgba(255,240,215,0.12)');
  lg.addColorStop(0.45, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(0,0,0,0.36)');
  ax.fillStyle = lg;
  ax.fillRect(0, 0, cam.W, cam.H);
  ax.globalCompositeOperation = 'source-over';
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(A, 0, 0);
  g.restore();
}
