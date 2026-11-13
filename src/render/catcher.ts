import { catcherRig, mittPts, mittState } from '../math/catcher';
import { dofBlur } from '../math/dof';
import { centroid, projPoly, sphereOutline, type Cam } from '../math/geometry';
import type { PreparedPitch } from '../math/kinematics';
import { lerp } from '../math/util';
import type { Pitch } from '../math/types';
import { view } from './env';
import { withFilter } from './filter';
import { capPath, fillPoly, tracePoly } from './paint';

/** The catcher: dark, soft-focus and low, never over the zone. The scene's lens defocuses him most of all. */
export function drawCatcher(g: CanvasRenderingContext2D, cam: Cam, P: Pitch): void {
  const m = catcherRig(P.batter.side, cam.eye);
  const h = m.head;

  g.save();
  withFilter(g, `blur(${(Math.max(2, dofBlur(cam, cam.p(h).d)) * view.dpr).toFixed(1)}px)`, (c) => {
    const back = '#0b1119';

    fillPoly(c, cam, [
      { x: h.x - 0.95, y: h.y - 0.05, z: h.z - 0.6 },
      { x: h.x + 0.95, y: h.y - 0.05, z: h.z - 0.6 },
      { x: h.x + 1.15, y: h.y - 0.25, z: h.z - 2.4 },
      { x: h.x - 1.15, y: h.y - 0.25, z: h.z - 2.4 },
    ], back);
    for (const sx of [-1, 1]) {
      const S = cam.p({ x: h.x + sx * 0.82, y: h.y - 0.05, z: h.z - 0.66 });

      c.beginPath();
      c.arc(S.x, S.y, 0.3 * S.k, 0, Math.PI * 2);
      c.fillStyle = back;
      c.fill();
    }
    const out = sphereOutline(cam, h, m.r, 72);

    if (out) {
      const ct = centroid(out);
      const rr = 0.42 * cam.p(h).k;
      const hg = c.createRadialGradient(ct.x - rr * 0.3, ct.y - rr * 0.62, rr * 0.05, ct.x, ct.y, rr * 1.15);

      hg.addColorStop(0, '#2c3749');
      hg.addColorStop(0.45, '#121a26');
      hg.addColorStop(1, '#080b11');
      c.beginPath();
      tracePoly(c, out);
      c.fillStyle = hg;
      c.fill();
    }
  });
  g.restore();
}

/** The mitt, under the catcher's layer and under the ball: the illustrative glove must never hide the real flight. */
export function drawMitt(g: CanvasRenderingContext2D, cam: Cam, P: PreparedPitch, s: number, alpha: number): void {
  const { p, pop, m } = mittState(P, s);
  const c = cam.p(p);

  if (c.y - 0.6 * c.k > cam.H + 10 || alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  // the key covers everything the glove's pixels depend on; alpha is applied when the result is composited
  const memo = { slot: 'mitt', key: [p.x, p.y, p.z, pop, cam.F, cam.cx, cam.cy, cam.yaw, cam.eye.x, cam.eye.y, cam.eye.z, P.batter.side].join('|') };

  withFilter(g, `blur(${(Math.max(1.5, dofBlur(cam, c.d)) * view.dpr).toFixed(1)}px)`, (k) => {
    const wrist = { x: p.x + 0.12 * (m.head.x - p.x), y: p.y - 0.3, z: p.z - 0.5 };
    const elbow = { x: lerp(p.x, m.head.x, 0.6) - m.sgn * 0.15, y: m.head.y + 0.3, z: p.z - 1.15 };
    const W = cam.p(wrist);
    const E = cam.p(elbow);

    k.beginPath();
    capPath(k, W, 0.16 * W.k, E, 0.2 * E.k);
    k.fillStyle = '#101722';
    k.fill();
    const sp = projPoly(cam, mittPts(p));

    if (sp.length > 2) {
      const r = 0.46 * c.k;
      const lg = k.createRadialGradient(c.x - r * 0.3, c.y - r * 0.45, r * 0.05, c.x, c.y + r * 0.1, r * 1.1);

      lg.addColorStop(0, '#4d311f');
      lg.addColorStop(0.55, '#2e1d12');
      lg.addColorStop(1, '#1a110b');
      k.beginPath();
      tracePoly(k, sp);
      k.fillStyle = lg;
      k.fill();
      // the laced rim catching the lights along the top, and the wrist strap across the back
      k.save();
      k.beginPath();
      tracePoly(k, sp);
      k.clip();
      k.lineWidth = Math.max(1.2, 0.05 * c.k);
      k.strokeStyle = 'rgba(176,122,78,0.45)';
      k.beginPath();
      k.ellipse(c.x, c.y + 0.06 * c.k, 0.41 * c.k, 0.44 * c.k, 0, Math.PI * 1.08, Math.PI * 1.92);
      k.stroke();
      k.fillStyle = 'rgba(120,80,50,0.35)';
      k.fillRect(c.x - r, c.y + 0.16 * c.k, 2 * r, 0.09 * c.k);
      k.restore();
      if (pop > 0) {
        // relative to the layer's alpha, so the fallback (which composites at `alpha`) matches the native path
        k.globalAlpha = k.globalAlpha * 0.14 * pop;
        k.fillStyle = '#fff3e0';
        k.beginPath();
        tracePoly(k, sp);
        k.fill();
      }
    }
  }, memo);
  g.restore();
}
