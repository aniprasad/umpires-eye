import { paintLog } from '../render/scene';

const KINDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['images', /\.(webp|png|jpe?g|avif|gif|svg)$/],
  ['data', /\.json$/],
  ['code', /\.(js|css|woff2?)$/],
];

const ms = (x: number): string => x.toFixed(0);
const kb = (x: number): string => (x / 1024).toFixed(0);

/**
 * The readout's text: the paint for each new stance during play, and what the page has loaded so far, by kind. Sizes are
 * the compressed bodies, so a file served from the cache still counts.
 */
export function timingText(): string {
  const loaded = new Map<string, number>();

  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    const kind = KINDS.find(([, ext]) => ext.test(new URL(entry.name).pathname))?.[0] ?? 'other';

    loaded.set(kind, (loaded.get(kind) ?? 0) + entry.encodedBodySize);
  }
  const total = [...loaded.values()].reduce((a, b) => a + b, 0);
  const paints = paintLog.length
    ? `last ${ms(paintLog[paintLog.length - 1] ?? 0)} ms, max ${ms(Math.max(...paintLog))} ms, mean ${ms(paintLog.reduce((a, b) => a + b, 0) / paintLog.length)} ms over ${paintLog.length}`
    : 'none yet';

  return [
    `?timing=1 at ${innerWidth}x${innerHeight}, DPR ${devicePixelRatio}`,
    `static paint per new stance: ${paints}`,
    `loaded (KB): images ${kb(loaded.get('images') ?? 0)}, data ${kb(loaded.get('data') ?? 0)}, code ${kb(loaded.get('code') ?? 0)}, total ${kb(total)}`,
  ].join('\n');
}

/** ?timing=1: the readout, on screen, for checking a real phone. It never takes a tap or a screen reader's time. */
export function showTiming(): void {
  const out = document.createElement('pre');
  const update = (): void => {
    out.textContent = timingText();
  };

  out.id = 'timing';
  out.setAttribute('aria-hidden', 'true');
  document.body.append(out);
  update();
  setInterval(update, 500);
}
