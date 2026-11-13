import type { LensCam } from '../math/geometry';
import { clamp } from '../math/util';

/** Image metrics measured on the art, in image pixels. */
export interface BackdropMeta {
  wallRow: number;
  towers: readonly (readonly [number, number])[];
  /** Fallback art: cover-fit on the wall line instead of true angular scale. */
  cover?: boolean;
  eyeTop?: number;
  cx?: number;
  /** Feet of batter's eye plus wall, which sets the true angular scale. */
  ft?: number;
}

const canvas = (): HTMLCanvasElement => document.createElement('canvas');

/** The viewport in CSS px and the device pixel ratio the canvases are drawn at. */
export const view = { dpr: 1, w: 1, h: 1 };

export const IMG = {
  backdrop: new Image(),
  bat: new Image(),
  bd: null as BackdropMeta | null,
};

/** The static scene (back: field and batter; front: catcher and mask) and three work sheets. */
export const LAY = { back: canvas(), front: canvas(), sA: canvas(), sB: canvas(), sC: canvas() };

/** The next pitch's layers, painted ahead while the reveal holds still, so "Next pitch" is a plain swap. */
export const NEXT = { key: '', cam: null as LensCam | null, back: canvas(), front: canvas() };

export function sizeCanvases(scene: HTMLCanvasElement): void {
  view.dpr = clamp(window.devicePixelRatio || 1, 1, 3);
  view.w = Math.max(1, Math.round(window.innerWidth));
  view.h = Math.max(1, Math.round(window.innerHeight));
  const w = Math.round(view.w * view.dpr);
  const h = Math.round(view.h * view.dpr);

  for (const c of [scene, LAY.back, LAY.front, LAY.sA, LAY.sB, LAY.sC, NEXT.back, NEXT.front]) {
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');

  if (!g) throw new Error('This browser has no 2D canvas.');

  return g;
}
