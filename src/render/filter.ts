import { ctx2d } from './env';

// Canvas 2D `filter` (blur and colour functions) isn't applied by every engine; WebKit, and so Safari, lacks it.
// Every filtered draw goes through withFilter: the native filter where the engine applies it, otherwise an
// approximation built from plain drawImage (downsampled, separable Gaussian taps) and a colour matrix.

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

/** A cleared work canvas. It is resized only when the target's size changes (a resize), never per draw. */
function scratch(i: number, w: number, h: number): CanvasRenderingContext2D {
  const c = scratchCanvases[i] || (scratchCanvases[i] = document.createElement('canvas'));

  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const x = ctx2d(c);

  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, w, h);

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
  dst.clearRect(0, 0, w, h);
  dst.imageSmoothingEnabled = true;
  gaussTaps(sigma).forEach((t, i) => {
    dst.globalCompositeOperation = i ? 'lighter' : 'source-over';
    dst.globalAlpha = t.w;
    dst.drawImage(src, horizontal ? t.off : 0, horizontal ? 0 : t.off);
  });
  dst.globalAlpha = 1;
  dst.globalCompositeOperation = 'source-over';
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

/** A fallback result kept for a draw that repeats every frame (the mitt while it holds still). */
interface Held {
  key: string;
  canvas: HTMLCanvasElement;
  sw: number;
  sh: number;
  k: number;
}

const held = new Map<string, Held>();

function composite(g: CanvasRenderingContext2D, src: HTMLCanvasElement, sw: number, sh: number, k: number): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(src, 0, 0, sw, sh, 0, 0, sw * k, sh * k);
  g.restore();
}

/**
 * Draws with a CSS filter string such as `blur(12.4px)` or `brightness(0.72) contrast(1.07)`. Blur lengths are in
 * canvas pixels, as the native filter treats them. The fallback draws the block on a work canvas scaled down by k so
 * the blur needs only a few taps, blurs it, and scales it back up; `draw` must set all the state it relies on.
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
  const sw = Math.ceil(g.canvas.width / k);
  const sh = Math.ceil(g.canvas.height / k);
  const m = g.getTransform();
  const key = memo ? `${memo.key}|${filter}|${g.canvas.width}x${g.canvas.height}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}` : '';
  const hit = memo ? held.get(memo.slot) : undefined;

  if (hit && hit.key === key) {
    composite(g, hit.canvas, hit.sw, hit.sh, hit.k);

    return;
  }
  const a = scratch(0, sw, sh);

  a.save();
  a.setTransform(m.a / k, m.b / k, m.c / k, m.d / k, m.e / k, m.f / k);
  draw(a);
  a.restore();
  if (colour) colourMatrix(a, sw, sh, spec);
  if (blur) {
    const b = scratch(1, sw, sh);

    blurPass(a.canvas, b, sw, sh, spec.blur / k, true);
    blurPass(b.canvas, a, sw, sh, spec.blur / k, false);
  }
  if (memo) {
    const keep = hit ? hit.canvas : document.createElement('canvas');

    if (keep.width !== sw || keep.height !== sh) {
      keep.width = sw;
      keep.height = sh;
    }
    const kc = ctx2d(keep);

    kc.clearRect(0, 0, sw, sh);
    kc.drawImage(a.canvas, 0, 0);
    held.set(memo.slot, { key, canvas: keep, sw, sh, k });
  }
  composite(g, a.canvas, sw, sh, k);
}
