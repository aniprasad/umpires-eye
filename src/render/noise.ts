import { mulberry32 } from '../core/rng.ts';

export interface Noise {
  fine: HTMLCanvasElement;
  coarse: HTMLCanvasElement;
  grain: HTMLCanvasElement;
  patchy: HTMLCanvasElement;
}

function sheet(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] {
  const c = document.createElement('canvas');

  c.width = c.height = size;
  const x = c.getContext('2d') as CanvasRenderingContext2D;

  return [c, x, x.createImageData(size, size)];
}

/**
 * The one source of decorative randomness (the ground and chalk texture): a seeded stream of its own, so every load
 * paints the same grain. Its seed is the one the parity tests give Math.random in the mockup (seedRandom), which draws
 * its noise first, so the two still match pixel for pixel.
 */
export const decorRandom = mulberry32(20261113);

/** Grey value noise, and alpha noise for the chalk: fine dropouts plus a coarse patchiness. */
export function makeNoise(rand: () => number = decorRandom): Noise {
  const mk = (size: number, amp: number): HTMLCanvasElement => {
    const [c, x, id] = sheet(size);

    for (let i = 0; i < id.data.length; i += 4) {
      const v = 128 + (rand() - 0.5) * amp;

      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);

    return c;
  };
  const fine = mk(256, 255);
  const small = mk(96, 255);
  const coarse = document.createElement('canvas');

  coarse.width = coarse.height = 96 * 7;
  const cx = coarse.getContext('2d') as CanvasRenderingContext2D;

  cx.imageSmoothingEnabled = true;
  cx.drawImage(small, 0, 0, coarse.width, coarse.height);
  const amk = (size: number, f: (r: number) => number): HTMLCanvasElement => {
    const [c, x, id] = sheet(size);

    for (let i = 0; i < id.data.length; i += 4) id.data[i + 3] = f(rand());
    x.putImageData(id, 0, 0);

    return c;
  };
  const grain = amk(128, (r) => (r < 0.22 ? 255 : r < 0.5 ? 110 : 0));
  const blot = amk(48, (r) => Math.round(255 * Math.pow(r, 2.2)));
  const patchy = document.createElement('canvas');

  patchy.width = patchy.height = 48 * 9;
  const px = patchy.getContext('2d') as CanvasRenderingContext2D;

  px.imageSmoothingEnabled = true;
  px.drawImage(blot, 0, 0, patchy.width, patchy.height);

  return { fine, coarse, grain, patchy };
}

let NOISE: Noise | null = null;

export function noise(): Noise {
  if (!NOISE) NOISE = makeNoise();

  return NOISE;
}
