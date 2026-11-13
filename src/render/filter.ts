import { ctx2d } from './env';

// Canvas 2D `filter` (blur and colour functions) isn't applied by every engine; WebKit, and so Safari, lacks it.
// Every filtered draw goes through withFilter: the native filter where the engine applies it, otherwise the block is
// drawn on a downsampled work canvas, blurred there (an exact Gaussian on its pixels, or drawImage taps when the
// canvas is too big for that) and put through a colour matrix.

let native: boolean | null = null;

function detect(): boolean {
  if (new URLSearchParams(location.search).get('canvasFilter') === 'fallback') return false;
  const c = document.createElement('canvas');

  c.width = 16;
  c.height = 4;
  const g = c.getContext('2d', { willReadFrequently: true });

  if (!g || typeof g.filter !== 'string') return false;
  g.filter = 'blur(2px)';
  if (g.filter !== 'blur(2px)') return false;
  g.fillStyle = '#fff';
  g.fillRect(8, 0, 8, 4);

  // three pixels left of the edge: only a real blur reaches it
  return g.getImageData(5, 2, 1, 1).data[3] > 0;
}

export function nativeFilter(): boolean {
  if (native === null) native = detect();

  return native;
}

interface FilterSpec {
  blur: number;
  brightness: number;
  contrast: number;
  saturate: number;
}

function parse(filter: string): FilterSpec {
  const spec: FilterSpec = { blur: 0, brightness: 1, contrast: 1, saturate: 1 };

  for (const m of filter.matchAll(/(blur|brightness|contrast|saturate)\(([\d.]+)(?:px)?\)/g)) spec[m[1] as keyof FilterSpec] = parseFloat(m[2]);

  return spec;
}

const scratchCanvases: HTMLCanvasElement[] = [];

// Work canvases are read back on almost every use; this asks engines that keep canvases on the GPU to keep these
// in memory instead, where a readback is cheap.
function workCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');

  c.getContext('2d', { willReadFrequently: true });

  return c;
}

/**
 * A work canvas with its top-left w × h (and a 2 px margin) cleared. It only ever grows, in practice once per
 * resize, so filtered draws never reallocate it; all the work happens in that top-left region.
 */
function scratch(i: number, w: number, h: number): CanvasRenderingContext2D {
  const c = scratchCanvases[i] || (scratchCanvases[i] = workCanvas());

  if (c.width < w + 2 || c.height < h + 2) {
    c.width = Math.max(c.width, w + 2);
    c.height = Math.max(c.height, h + 2);
  }
  const x = ctx2d(c);

  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, w + 2, h + 2);

  return x;
}

/** Normalised taps of a Gaussian, pairs merged into one bilinear sample each (linear sampling). */
function gaussTaps(sigma: number): { off: number; w: number }[] {
  const R = Math.max(1, Math.ceil(sigma * 3));
  const wts: number[] = [];
  let sum = 0;

  for (let i = 0; i <= R; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));

    wts.push(v);
    sum += i ? 2 * v : v;
  }
  const taps = [{ off: 0, w: wts[0] / sum }];

  for (let i = 1; i <= R; i += 2) {
    const w1 = wts[i];
    const w2 = i + 1 <= R ? wts[i + 1] : 0;
    const off = (i * w1 + (i + 1) * w2) / (w1 + w2);

    taps.push({ off, w: (w1 + w2) / sum }, { off: -off, w: (w1 + w2) / sum });
  }

  return taps;
}

function blurPass(src: HTMLCanvasElement, dst: CanvasRenderingContext2D, w: number, h: number, sigma: number, horizontal: boolean): void {
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.globalAlpha = 1;
  dst.globalCompositeOperation = 'source-over';
  dst.clearRect(0, 0, w + 2, h + 2);
  dst.imageSmoothingEnabled = true;
  gaussTaps(sigma).forEach((t, i) => {
    dst.globalCompositeOperation = i ? 'lighter' : 'source-over';
    dst.globalAlpha = t.w;
    dst.drawImage(src, 0, 0, w, h, horizontal ? t.off : 0, horizontal ? 0 : t.off, w, h);
  });
  dst.globalAlpha = 1;
  dst.globalCompositeOperation = 'source-over';
}

/** Above this many tap-pixels a pass, the exact blur would stall a paint; only small full-size blurs get that far. */
const EXACT_TAPS = 3e6;

/** One pass of a Gaussian along lines of samples (`step` apart within a line, `lineStep` between lines). */
function convolve(src: Float32Array, dst: Float32Array, lines: number, len: number, step: number, lineStep: number, k: Float32Array): void {
  const R = (k.length - 1) / 2;

  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;

    for (let x = 0; x < len; x++) {
      const t0 = Math.max(-R, -x);
      const t1 = Math.min(R, len - 1 - x);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let t = t0; t <= t1; t++) {
        const j = base + (x + t) * step;
        const wt = k[t + R];

        r += src[j] * wt;
        g += src[j + 1] * wt;
        b += src[j + 2] * wt;
        a += src[j + 3] * wt;
      }
      const i = base + x * step;

      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = a;
    }
  }
}

/**
 * An exact separable Gaussian over a work canvas's pixels, in premultiplied floats. Summing faint drawImage taps
 * rounds each tap to 8 bits, and WebKit rounds them up, so a 19-tap blur of a dark navy comes out grey; here nothing
 * is rounded until the end. Outside the canvas counts as transparent, as it does for the native filter.
 */
function blurExact(c: CanvasRenderingContext2D, w: number, h: number, sigma: number): void {
  const R = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * R + 1);
  let sum = 0;

  for (let i = -R; i <= R; i++) {
    k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + R];
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const a = new Float32Array(d.length);
  const b = new Float32Array(d.length);

  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3] / 255;

    a[i] = d[i] * al;
    a[i + 1] = d[i + 1] * al;
    a[i + 2] = d[i + 2] * al;
    a[i + 3] = d[i + 3];
  }
  convolve(a, b, h, w, 4, 4 * w, k);
  convolve(b, a, w, h, 4 * w, 4, k);
  for (let i = 0; i < d.length; i += 4) {
    const al = a[i + 3];
    const f = al > 0.5 ? 255 / al : 0;

    d[i] = a[i] * f;
    d[i + 1] = a[i + 1] * f;
    d[i + 2] = a[i + 2] * f;
    d[i + 3] = f ? al : 0;
  }
  c.putImageData(img, 0, 0);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** brightness, then contrast, then saturate, in the order the CSS filter list applies them. */
function colourMatrix(c: CanvasRenderingContext2D, w: number, h: number, s: FilterSpec): void {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const q = s.saturate;
  const m = [
    0.213 + 0.787 * q, 0.715 - 0.715 * q, 0.072 - 0.072 * q,
    0.213 - 0.213 * q, 0.715 + 0.285 * q, 0.072 - 0.072 * q,
    0.213 - 0.213 * q, 0.715 - 0.715 * q, 0.072 + 0.928 * q,
  ];
  const tone = (v: number): number => clamp01((clamp01((v / 255) * s.brightness) - 0.5) * s.contrast + 0.5);

  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = tone(d[i]);
    const g = tone(d[i + 1]);
    const b = tone(d[i + 2]);

    d[i] = Math.round(255 * clamp01(m[0] * r + m[1] * g + m[2] * b));
    d[i + 1] = Math.round(255 * clamp01(m[3] * r + m[4] * g + m[5] * b));
    d[i + 2] = Math.round(255 * clamp01(m[6] * r + m[7] * g + m[8] * b));
  }
  c.putImageData(img, 0, 0);
}

/** Where a block lands on the target, in target pixels. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A fallback result kept for a draw that repeats every frame (the mitt while it holds still). */
interface Held {
  key: string;
  canvas: HTMLCanvasElement;
  box: Box;
  sw: number;
  sh: number;
  k: number;
}

const held = new Map<string, Held>();

function composite(g: CanvasRenderingContext2D, src: HTMLCanvasElement, box: Box, sw: number, sh: number, k: number): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(src, 0, 0, sw, sh, box.x, box.y, sw * k, sh * k);
  g.restore();
}

// Content boxes are found at 1/8 scale: cheap, and fine enough that a thin line still leaves some alpha.
const DETECT = 8;

/**
 * The part of the target a block draws in, grown by `reach` (how far its blur spreads), or null if it draws nothing.
 * The block is drawn once more on a coarse work canvas, whose alpha shows where it went.
 */
function contentBox(draw: (c: CanvasRenderingContext2D) => void, m: DOMMatrix, W: number, H: number, reach: number): Box | null {
  const dw = Math.ceil(W / DETECT);
  const dh = Math.ceil(H / DETECT);
  const d = scratch(2, dw, dh);

  d.save();
  d.setTransform(m.a / DETECT, m.b / DETECT, m.c / DETECT, m.d / DETECT, m.e / DETECT, m.f / DETECT);
  draw(d);
  d.restore();
  const px = d.getImageData(0, 0, dw, dh).data;
  let x0 = dw;
  let y0 = dh;
  let x1 = -1;
  let y1 = -1;

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      if (!px[4 * (y * dw + x) + 3]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  const pad = Math.ceil(reach) + 2 * DETECT;
  const l = Math.max(0, x0 * DETECT - pad);
  const t = Math.max(0, y0 * DETECT - pad);

  return { x: l, y: t, w: Math.min(W, (x1 + 1) * DETECT + pad) - l, h: Math.min(H, (y1 + 1) * DETECT + pad) - t };
}

/**
 * Draws with a CSS filter string such as `blur(12.4px)` or `brightness(0.72) contrast(1.07)`. Blur lengths are in
 * canvas pixels, as the native filter treats them. The fallback draws the block on a work canvas scaled down by k so
 * the blur needs only a few taps, blurs it, and scales it back up; `draw` must set all the state it relies on and
 * draw the same thing every time it's called. Where k is small the work canvas covers only the block's own box,
 * since a full-size pass would cost as much for a few shadows as for the whole field.
 * A per-frame caller passes `memo` (a slot and a key covering everything `draw` depends on): while the key holds,
 * the fallback reuses its last result instead of blurring again.
 */
export function withFilter(
  g: CanvasRenderingContext2D,
  filter: string,
  draw: (c: CanvasRenderingContext2D) => void,
  memo?: { slot: string; key: string },
): void {
  if (nativeFilter()) {
    const prev = g.filter;

    g.filter = filter;
    draw(g);
    g.filter = prev;

    return;
  }
  const spec = parse(filter);
  const colour = spec.brightness !== 1 || spec.contrast !== 1 || spec.saturate !== 1;
  const blur = spec.blur >= 0.35;

  if (!blur && !colour) {
    draw(g);

    return;
  }
  const k = colour ? 1 : Math.min(16, Math.max(1, Math.floor(spec.blur / 1.25)));
  const W = g.canvas.width;
  const H = g.canvas.height;
  const m = g.getTransform();
  const key = memo ? `${memo.key}|${filter}|${W}x${H}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}` : '';
  const hit = memo ? held.get(memo.slot) : undefined;

  if (hit && hit.key === key) {
    composite(g, hit.canvas, hit.box, hit.sw, hit.sh, hit.k);

    return;
  }
  const box = k <= 4 ? contentBox(draw, m, W, H, blur ? 3 * spec.blur : 0) : { x: 0, y: 0, w: W, h: H };

  if (!box) return;
  const sw = Math.ceil(box.w / k);
  const sh = Math.ceil(box.h / k);
  const a = scratch(0, sw, sh);

  a.save();
  a.setTransform(m.a / k, m.b / k, m.c / k, m.d / k, (m.e - box.x) / k, (m.f - box.y) / k);
  draw(a);
  a.restore();
  if (colour) colourMatrix(a, sw, sh, spec);
  if (blur) {
    const sigma = spec.blur / k;

    if (sw * sh * (2 * Math.ceil(3 * sigma) + 1) <= EXACT_TAPS) blurExact(a, sw, sh, sigma);
    else {
      const b = scratch(1, sw, sh);

      blurPass(a.canvas, b, sw, sh, sigma, true);
      blurPass(b.canvas, a, sw, sh, sigma, false);
    }
  }
  if (memo) {
    const keep = hit ? hit.canvas : document.createElement('canvas');

    if (keep.width < sw || keep.height < sh) {
      keep.width = Math.max(keep.width, sw);
      keep.height = Math.max(keep.height, sh);
    }
    const kc = ctx2d(keep);

    kc.clearRect(0, 0, sw, sh);
    kc.drawImage(a.canvas, 0, 0, sw, sh, 0, 0, sw, sh);
    held.set(memo.slot, { key, canvas: keep, box, sw, sh, k });
  }
  composite(g, a.canvas, box, sw, sh, k);
}
