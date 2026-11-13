import type { LensCam } from '../math/geometry';
import { maskGeom, type MaskBar } from '../math/mask';
import { withFilter } from './filter';

/** The umpire's mask: dark, defocused cage bars at the bottom corners and up the sides, clear of the play. */
export function drawMask(g: CanvasRenderingContext2D, cam: LensCam): void {
  const { bars, t, bl } = maskGeom(cam);

  if (!bars.length) return;
  g.save();
  withFilter(g, `blur(${bl.toFixed(1)}px)`, (c) => {
    const trace = (b: MaskBar, inset: number): void => {
      c.beginPath();
      if (b.k === 'arc') {
        const a0 = b.sx ? Math.PI : 1.5 * Math.PI;

        c.arc(b.C.x, b.C.y, b.rho - inset, a0, a0 + Math.PI / 2);
      } else {
        const dx = (b.sx ? -1 : 1) * inset;

        c.moveTo(b.x + dx, b.y0);
        c.quadraticCurveTo(b.x + dx + (b.sx ? -1 : 1) * 0.8 * t, (b.y0 + b.y1) / 2, b.x + dx, b.y1);
      }
    };

    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const b of bars) {
      trace(b, 0);
      c.lineWidth = t;
      c.strokeStyle = 'rgba(3,5,9,0.9)';
      c.stroke();
    }
    // the inner face of each bar catches a little of the floods
    for (const b of bars) {
      trace(b, 0.3 * t);
      c.lineWidth = 0.2 * t;
      c.strokeStyle = 'rgba(150,170,200,0.13)';
      c.stroke();
    }
  });
  g.restore();
}
