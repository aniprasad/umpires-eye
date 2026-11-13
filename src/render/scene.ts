import { catcherRig } from '../math/catcher';
import type { LensCam } from '../math/geometry';
import type { PreparedPitch } from '../math/kinematics';
import type { Lens } from '../math/lens';
import { eyeOf } from '../math/stance';
import { drawBackdrop } from './backdrop';
import { drawBatter } from './batter';
import { drawCatcher } from './catcher';
import { ctx2d, IMG, LAY, NEXT, view } from './env';
import { castShadows, chalkSheet, drawGround, drawMound, drawPlate, groundLight, groundTexture } from './field';
import { withFilter } from './filter';
import { drawMask } from './mask';

/** The back layer: sky, far stands, the infield in exact perspective, the lights, and the batter. */
export function paintBack(cv: HTMLCanvasElement, cam: LensCam, P: PreparedPitch): void {
  const g = ctx2d(cv);
  const dpr = view.dpr;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, cam.cy);

  sky.addColorStop(0, '#040912');
  sky.addColorStop(1, '#0a1524');
  g.fillStyle = sky;
  g.fillRect(0, 0, cam.W, cam.H);
  drawBackdrop(g, cam);
  const wallY = cam.p({ x: 0, y: 400, z: 0 }).y;

  drawGround(g, cam);
  drawMound(g, cam);
  groundTexture(g, wallY);
  chalkSheet(g, cam);
  drawPlate(g, cam);
  groundLight(g, cam, wallY);
  // the catcher's own soft shadows reach forward under the plate (he is in the front layer)
  const cm = catcherRig(P.batter.side, cam.eye);

  g.save();
  withFilter(g, `blur(${Math.max(2, 0.01 * cam.F).toFixed(1)}px)`, (c) => castShadows(c, cam, cm.head.x, cm.head.y + 0.35, 3.0, 0.1));
  g.restore();
  drawBatter(g, cam, P);
}

/** The front layer: the catcher and the mask, over the mitt and under the ball. */
export function paintFront(cv: HTMLCanvasElement, cam: LensCam, P: PreparedPitch): void {
  const g = ctx2d(cv);
  const dpr = view.dpr;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawCatcher(g, cam, P);
  drawMask(g, cam);
}

/** The static layers in LAY belong to this key (stance, batter, viewport, assets) and this camera. */
export const scene = { key: '', cam: null as LensCam | null };

export function staticKeyFor(P: PreparedPitch): string {
  const e = eyeOf(P);

  return [P.batter.side, P.batter.heightFt, e.x, e.y, e.z, view.w, view.h, view.dpr, IMG.backdrop.naturalWidth, IMG.bat.naturalWidth].join('|');
}

/** Makes LAY hold this pitch's static scene: a swap if it was painted ahead, otherwise a paint. */
export function ensureStatic(lens: Lens, P: PreparedPitch): LensCam {
  const key = staticKeyFor(P);

  if (key === scene.key && scene.cam) return scene.cam;
  scene.key = key;
  if (NEXT.key === key && NEXT.cam) {
    [LAY.back, NEXT.back] = [NEXT.back, LAY.back];
    [LAY.front, NEXT.front] = [NEXT.front, LAY.front];
    scene.cam = NEXT.cam;
    NEXT.key = '';

    return scene.cam;
  }
  const cam = lens.camFor(view.w, view.h, P);

  scene.cam = cam;
  paintBack(LAY.back, cam, P);
  paintFront(LAY.front, cam, P);

  return cam;
}

/** Paints the next pitch's scene (new eye, new batter, lens blur) off screen, so "Next pitch" is a cut, not a hitch. */
export function paintAhead(lens: Lens, P: PreparedPitch): void {
  const key = staticKeyFor(P);

  if (key === NEXT.key || key === scene.key) return;
  const cam = lens.camFor(view.w, view.h, P);

  paintBack(NEXT.back, cam, P);
  paintFront(NEXT.front, cam, P);
  NEXT.key = key;
  NEXT.cam = cam;
}

export function invalidateStatic(): void {
  scene.key = '';
  NEXT.key = '';
}
