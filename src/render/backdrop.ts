import type { Cam } from '../math/geometry';
import { IMG, type BackdropMeta } from './env';
import { withFilter } from './filter';

/**
 * The far background. The wide art is drawn at true angular scale: 45 ft of batter's eye plus wall at 400 ft sets the
 * scale, with no cheat. Metrics are measured on each image, in image pixels.
 */
export const BACKDROPS: { wide: BackdropMeta; old: BackdropMeta } = {
  wide: { wallRow: 502.5, eyeTop: 378, cx: 766, ft: 45, towers: [[88, 125], [387, 222], [1137, 223], [1442, 121]] },
  old: { wallRow: 478, cover: true, towers: [[232, 78], [1303, 78]] },
};

export function drawBackdrop(g: CanvasRenderingContext2D, cam: Cam): void {
  const img = IMG.backdrop;
  const bd = IMG.bd;

  if (!img.naturalWidth || !bd) return;
  // the centre-field wall base
  const wall = cam.p({ x: 0, y: 400, z: 0 });
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let s: number;
  let left: number;
  let top: number;

  if (bd.cover) {
    const WALL_ROW = bd.wallRow * ih / 1024;
    const CXI = iw / 2;

    s = Math.max(cam.W / iw, wall.y / WALL_ROW, wall.x / CXI, (cam.W - wall.x) / (iw - CXI));
    left = wall.x - CXI * s;
    top = wall.y - WALL_ROW * s;
  } else {
    const D = Math.hypot(cam.eye.x, 400 - cam.eye.y);

    s = cam.F * (bd.ft ?? 45) / (D * (bd.wallRow - (bd.eyeTop ?? 0)));
    left = wall.x - (bd.cx ?? iw / 2) * s;
    top = wall.y - bd.wallRow * s;
  }
  const W = iw * s;
  const Hh = ih * s;

  g.save();
  // the stands sit far outside the depth of field
  withFilter(g, `blur(${(0.002 * cam.F).toFixed(2)}px)`, (c) => {
    c.drawImage(img, left, top, W, Hh);
    // wider than the art: the stands continue as mirrored copies, a touch darker toward the frame edge
    if (left > 0) {
      c.save();
      c.translate(left, 0);
      c.scale(-1, 1);
      c.drawImage(img, 0, top, W, Hh);
      c.restore();
    }
    if (left + W < cam.W) {
      c.save();
      c.translate(left + W, 0);
      c.scale(-1, 1);
      c.drawImage(img, -W, top, W, Hh);
      c.restore();
    }
  });
  if (left > 0) {
    const sh = g.createLinearGradient(left, 0, 0, 0);

    sh.addColorStop(0, 'rgba(4,8,14,0)');
    sh.addColorStop(1, 'rgba(4,8,14,0.35)');
    g.fillStyle = sh;
    g.fillRect(0, 0, left, wall.y);
  }
  if (left + W < cam.W) {
    const sh = g.createLinearGradient(left + W, 0, cam.W, 0);

    sh.addColorStop(0, 'rgba(4,8,14,0)');
    sh.addColorStop(1, 'rgba(4,8,14,0.35)');
    g.fillStyle = sh;
    g.fillRect(left + W, 0, cam.W - left - W, wall.y);
  }
  // floodlight bloom: at true scale the towers sit above the frame, and their light spills in
  g.globalCompositeOperation = 'screen';
  const heads: [number, number][] = [];

  for (const [tx, ty] of bd.towers) {
    const x = left + tx * s;
    const y = top + ty * s;

    heads.push([x, y]);
    if (left > 0) heads.push([2 * left - x, y]);
    if (left + W < cam.W) heads.push([2 * (left + W) - x, y]);
  }
  const R = Math.max(cam.W, cam.H) * 0.5;

  for (const [x, y] of heads) {
    if (x < -0.4 * cam.W || x > 1.4 * cam.W) continue;
    const rg = g.createRadialGradient(x, y, 0, x, y, R);

    rg.addColorStop(0, 'rgba(255,248,232,0.55)');
    rg.addColorStop(0.18, 'rgba(255,242,218,0.17)');
    rg.addColorStop(0.5, 'rgba(255,236,206,0.04)');
    rg.addColorStop(1, 'rgba(255,236,206,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, cam.W, wall.y + 40);
    // a head above the frame: its glare and haze pour in over the top edge
    if (y < 0) {
      const R2 = Math.max(cam.W, cam.H) * 0.85;
      const gl = g.createRadialGradient(x, y, 0, x, y, R2);

      gl.addColorStop(0, 'rgba(255,244,222,0.42)');
      gl.addColorStop(0.2, 'rgba(255,238,210,0.15)');
      gl.addColorStop(0.55, 'rgba(255,232,200,0.035)');
      gl.addColorStop(1, 'rgba(255,232,200,0)');
      g.fillStyle = gl;
      g.fillRect(0, 0, cam.W, wall.y + 40);
    }
  }
  g.restore();
}
