import { posAt, type Vec3 } from '../core/kinematics.ts';
import { BALL_R, MID_Y, PLATE_HALF } from '../core/rules.ts';
import { centroid, sphereOutline, type Cam, type Projected } from '../math/geometry';
import { ballT, type PreparedPitch } from '../math/kinematics';
import { clamp, easeOut3, lerp, ramp } from '../math/util';
import { drawBall } from './ball';
import { tracePoly } from './paint';

/** Reveal beats, seconds from its start: chip, then the chalk zone draws itself, then the ring and path, then the verdict. */
export const RV = { zone0: 0.18, zone1: 0.62, path0: 0.55, path1: 0.95, ring0: 0.62, ring1: 0.95, body: 0.95 } as const;

/** Scene time s (seconds since release) and reveal time r (null before the reveal). */
export interface SceneState {
  s: number;
  r: number | null;
  /** How much of the foreground (catcher, mask, glove) stays while the zone comes forward. */
  fg?: number;
  replay?: boolean;
}

interface Dot {
  w: Vec3;
  q: Projected;
  t: number;
}

const DOTS = new WeakMap<PreparedPitch, { key: string; dots: Dot[] }>();

/** The dotted path from the release point to the ABS plane, spaced evenly on screen. */
export function pathDots(cam: Cam, P: PreparedPitch): Dot[] {
  const key = `${cam.F}|${cam.cx}|${cam.cy}|${cam.eye.x}|${cam.eye.y}|${cam.eye.z}`;
  const hit = DOTS.get(P);

  if (hit && hit.key === key) return hit.dots;
  const out: Dot[] = [];
  const tr = P.traj;
  let last: Projected | null = null;

  for (let t = P.k.tRel; t < P.k.tMid; t += 0.0008) {
    const w = posAt(tr, t);
    const q = cam.p(w);

    if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= 13) {
      out.push({ w, q, t });
      last = q;
    }
  }
  const qm = cam.p(P.k.mid);

  if (last && Math.hypot(qm.x - last.x, qm.y - last.y) < 7) out.pop();
  DOTS.set(P, { key, dots: out });

  return out;
}

export function drawReveal(g: CanvasRenderingContext2D, cam: Cam, P: PreparedPitch, st: SceneState): void {
  const r = st.r ?? 0;
  // the spotlight: the scene steps back, the zone comes forward
  const dimA = easeOut3(r / 0.35);
  const zt = cam.p({ x: 0, y: MID_Y, z: P.zone.top });
  const zb = cam.p({ x: 0, y: MID_Y, z: P.zone.bottom });
  const zc = { x: (zt.x + zb.x) / 2, y: (zt.y + zb.y) / 2 };
  const zh = zb.y - zt.y;
  const rg = g.createRadialGradient(zc.x, zc.y, zh * 0.55, zc.x, zc.y, Math.max(cam.W, cam.H) * 0.8);

  rg.addColorStop(0, 'rgba(3,7,5,0)');
  rg.addColorStop(0.3, `rgba(3,7,5,${0.32 * dimA})`);
  rg.addColorStop(1, `rgba(3,7,5,${0.6 * dimA})`);
  g.fillStyle = rg;
  g.fillRect(0, 0, cam.W, cam.H);

  // the chalk zone, true size at mid-plate, drawing itself clockwise from the top-left corner
  const zp = st.replay ? 1 : easeOut3(ramp(r, RV.zone0, RV.zone1));

  if (zp > 0) {
    const zz = P.zone;
    const corners: [number, number][] = [[-PLATE_HALF, zz.top], [PLATE_HALF, zz.top], [PLATE_HALF, zz.bottom], [-PLATE_HALF, zz.bottom]];
    const c = corners.map(([x, z]) => cam.p({ x, y: MID_Y, z }));
    const lens = c.map((a, i) => {
      const b = c[(i + 1) % 4];

      return Math.hypot(b.x - a.x, b.y - a.y);
    });
    let left = zp * lens.reduce((a, b) => a + b, 0);

    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (zp >= 1) {
      g.beginPath();
      tracePoly(g, c);
      g.fillStyle = 'rgba(246,243,234,0.05)';
      g.fill();
    }
    g.beginPath();
    g.moveTo(c[0].x, c[0].y);
    for (let i = 0; i < 4 && left > 0; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      const t = Math.min(1, left / lens[i]);

      g.lineTo(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
      left -= lens[i];
    }
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 7;
    g.shadowOffsetY = 1;
    g.strokeStyle = 'rgba(247,244,236,0.96)';
    g.lineWidth = 2.6;
    g.stroke();
    g.restore();
  }

  // the dotted path from release (it grows with the ball in the slow replay)
  const dots = pathDots(cam, P);
  const tBall = ballT(P, st.s);
  const nDots = st.replay ? dots.filter((d) => d.t <= tBall).length : Math.floor(dots.length * easeOut3(ramp(r, RV.path0, RV.path1)));

  if (nDots > 0) {
    g.save();
    g.fillStyle = 'rgba(247,244,236,0.92)';
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 3;
    for (let i = 0; i < nDots; i++) {
      const q = dots[i].q;

      g.beginPath();
      g.arc(q.x, q.y, clamp(0.028 * q.k, 1.2, 3), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  // the magenta ring: the true-size ball where it crossed the ABS plane
  const rp = st.replay ? ramp(st.s, P.k.toMid, P.k.toMid + 0.05) : ramp(r, RV.ring0, RV.ring1);

  if (rp > 0) {
    const e = easeOut3(rp);
    const sp = sphereOutline(cam, P.k.mid, BALL_R, 48) || [cam.p(P.k.mid)];
    const c = centroid(sp);
    const rr = sp.reduce((m, p) => m + Math.hypot(p.x - c.x, p.y - c.y), 0) / sp.length;

    g.save();
    g.globalAlpha = e;
    g.beginPath();
    tracePoly(g, sp);
    const bg = g.createRadialGradient(c.x - rr * 0.35, c.y - rr * 0.45, rr * 0.1, c.x, c.y, rr * 1.05);

    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.6, '#f1eee6');
    bg.addColorStop(1, '#c9c4b8');
    g.fillStyle = bg;
    g.fill();
    const sc = (1 + (1 - e) * 1.3) * (rr + 4.5) / rr;

    g.beginPath();
    sp.forEach((p, i) => {
      const x = c.x + (p.x - c.x) * sc;
      const y = c.y + (p.y - c.y) * sc;

      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    g.closePath();
    g.lineWidth = 3.2;
    g.strokeStyle = '#E20074';
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 5;
    g.stroke();
    g.restore();
  }
  if (st.replay) drawBall(g, cam, P, st.s);
}
