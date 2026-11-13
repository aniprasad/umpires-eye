import { BALL_R, TRAIL } from '../math/constants';
import { sphereOutline, type Cam, type Projected } from '../math/geometry';
import { ballT, posAt, type PreparedPitch } from '../math/kinematics';
import type { Vec3 } from '../math/types';
import { capPath, tracePoly } from './paint';

/** The ball's outline at its true size: the exact projected silhouette once it's big enough to show one. */
export function ballShape(g: CanvasRenderingContext2D, cam: Cam, c: Vec3): { q: Projected; rp: number } {
  const q = cam.p(c);
  const rp = BALL_R * q.k;

  if (rp < 2.5) {
    g.beginPath();
    g.arc(q.x, q.y, Math.max(rp, 0.9), 0, Math.PI * 2);

    return { q, rp };
  }
  const sp = sphereOutline(cam, c, BALL_R, rp > 12 ? 48 : 28) || [q];

  g.beginPath();
  tracePoly(g, sp);

  return { q, rp };
}

/** The ball on its exact path at real time (s seconds since release), crisp and always on top. */
export function drawBall(g: CanvasRenderingContext2D, cam: Cam, P: PreparedPitch, s: number): void {
  if (s < 0 || s > P.k.toCatch) return;
  const t = ballT(P, s);
  const tr = P.traj;
  const c = posAt(tr, t);
  // a faint speed trail: the last ~10 ms of the real path
  const t0 = Math.max(P.k.tRel, t - TRAIL);

  if (t - t0 > 0.0015) {
    const a = cam.p(posAt(tr, t0));
    const b = cam.p(c);
    const ga = g.createLinearGradient(a.x, a.y, b.x, b.y);

    ga.addColorStop(0, 'rgba(255,253,246,0)');
    ga.addColorStop(1, 'rgba(255,253,246,0.3)');
    g.beginPath();
    capPath(g, a, Math.max(BALL_R * a.k * 0.85, 0.5), b, Math.max(BALL_R * b.k * 0.9, 0.7));
    g.fillStyle = ga;
    g.fill();
  }
  const { q, rp } = ballShape(g, cam, c);

  if (rp >= 2.5) {
    const hl = g.createRadialGradient(q.x - rp * 0.35, q.y - rp * 0.45, rp * 0.1, q.x, q.y, rp * 1.05);

    hl.addColorStop(0, '#ffffff');
    hl.addColorStop(0.55, '#f4f1e9');
    hl.addColorStop(1, '#c9c4b8');
    g.fillStyle = hl;
  } else g.fillStyle = '#fbfaf5';
  g.fill();
}
