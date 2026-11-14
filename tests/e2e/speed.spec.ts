import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockupUrl, waitReady } from './helpers';

// A trace's screencast copies every frame the page draws, and its DOM snapshots wait on the page between steps. In
// WebKit they made the frames this test compares three times slower, so its traces keep the steps and their timings
// without either. (Playwright sets traces per file, not per test.)
test.use({ trace: { mode: 'retain-on-failure', screenshots: false, snapshots: false } });

interface FrameStats {
  frames: number;
  costP50: number;
  costP95: number;
  costMax: number;
  gapP50: number;
  gapP95: number;
  /** Static paints during the frames. */
  paints: number;
  /** getImageData calls during the frames: the fallback filter's read-backs. */
  reads: number;
  readsMax: number;
  /** Frames that read anything back. */
  readFrames: number;
}

type Frames = { costs: number[]; stamps: number[]; reads: number[]; paints: number[]; start: number };

/**
 * Times every animation frame callback the page runs, its script cost and when it ran, since the last "Play ball", and
 * counts the work each one does: the pixels it reads back, and the static paints the app counts with ?work=1.
 */
async function timeFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const frames = { costs: [] as number[], stamps: [] as number[], reads: [] as number[], paints: [] as number[], start: 0 };
    const getImageData = CanvasRenderingContext2D.prototype.getImageData;
    let reads = 0;

    CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, settings?: ImageDataSettings): ImageData {
      reads++;

      return getImageData.call(this, sx, sy, sw, sh, settings);
    };
    Object.assign(window, { ueFrames: frames });
    addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      frames.costs.length = 0;
      frames.stamps.length = 0;
      frames.reads.length = 0;
      frames.paints.length = 0;
      frames.start = performance.now();
    }, true);
    window.requestAnimationFrame = (cb) => raf((t) => {
      const work = (window as unknown as { ueWork?: { staticPaints: number } }).ueWork;
      const reads0 = reads;
      const paints0 = work?.staticPaints ?? 0;
      const t0 = performance.now();

      cb(t);
      frames.costs.push(performance.now() - t0);
      frames.stamps.push(t);
      frames.reads.push(reads - reads0);
      frames.paints.push((work?.staticPaints ?? 0) - paints0);
    });
  });
}

// The first pitch releases 2.4 s after "Play ball" and is caught 2.81 s after it, so this takes in the beat, the windup,
// the flight and the catch. Six-second windows ran on into the reveal, and with them WebKit ran past the test's timeout.
const SAMPLE_MS = 3000;
// A frame slower than the whole window, such as a static scene blurred afresh, still leaves gaps to compare.
const MIN_FRAMES = 3;

/** The live part of one pitch: SAMPLE_MS of page time from "Play ball", and MIN_FRAMES frames at least. */
async function pitchFrames(page: Page, url: string): Promise<FrameStats> {
  await page.goto(url);
  await waitReady(page);
  await page.keyboard.press('Enter');
  const { costs, stamps, reads, paints } = await page.evaluate(([ms, n]) => new Promise<Frames>((resolve) => {
    const f = (window as unknown as { ueFrames: Frames }).ueFrames;
    const check = (): void => {
      if (performance.now() - f.start >= ms && f.stamps.length >= n) resolve(f);
      else setTimeout(check, 50);
    };

    check();
  }), [SAMPLE_MS, MIN_FRAMES] as const);
  const pct = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
  const gaps = [...new Set(stamps)].sort((a, b) => a - b).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1);
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

  return {
    frames: costs.length, costP50: pct(costs, 0.5), costP95: pct(costs, 0.95), costMax: Math.max(...costs), gapP50: pct(gaps, 0.5), gapP95: pct(gaps, 0.95),
    paints: sum(paints), reads: sum(reads), readsMax: Math.max(...reads), readFrames: reads.filter((r) => r > 0).length,
  };
}

const fmtFrames = (f: FrameStats): string => `${f.frames} frames; script per frame P50 ${f.costP50.toFixed(2)} ms, P95 ${f.costP95.toFixed(2)} ms, max ${f.costMax.toFixed(1)} ms; frame gap P50 ${f.gapP50.toFixed(1)} ms, P95 ${f.gapP95.toFixed(1)} ms; static paints ${f.paints}; read-backs ${f.reads} in ${f.readFrames} frames, at most ${f.readsMax} in one`;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// The runs take turns, one pitch each per round, so load that comes and goes on a shared machine falls on every run
// alike, and the medians over the rounds compare like with like. Two windows taken one after the other did neither.
const SPEED_ROUNDS = 3;

test('a live pitch with the fallback filter repaints no static layer, keeps the mitt\'s blur, and runs about as fast as the mockup', async ({ page, baseURL, browserName }, testInfo) => {
  test.setTimeout(120_000);
  // The mockup sets canvas filters and, where the engine ignores them (WebKit), simply goes without its blurs:
  // the frame time of the same scene with no defocus at all.
  const runs: [string, string][] = [['mockup', mockupUrl('')], ['port, fallback filter', new URL('./?pool=ws&canvasFilter=fallback&work=1', baseURL).href]];

  if (browserName === 'chromium') runs.push(['port, native filter', new URL('./?pool=ws&work=1', baseURL).href]);
  await timeFrames(page);
  const rounds: Record<string, FrameStats>[] = [];

  for (let r = 1; r <= SPEED_ROUNDS; r++) {
    const round: Record<string, FrameStats> = {};

    for (const [name, url] of runs) {
      round[name] = await pitchFrames(page, url);
      testInfo.annotations.push({ type: `frames (${name}, round ${r})`, description: fmtFrames(round[name]) });
    }
    rounds.push(round);
  }
  const gap = (name: string): number => median(rounds.map((round) => round[name].gapP50));

  testInfo.annotations.push({ type: 'frame gap P50, median of rounds', description: runs.map(([name]) => `${name} ${gap(name).toFixed(1)} ms`).join('; ') });
  await testInfo.attach('frames.json', { body: JSON.stringify(rounds, null, 2), contentType: 'application/json' });
  // The work each frame does is the guard; frame times on a shared machine move with its load. No frame paints the
  // static scene, and a frame reads pixels back only to blur the mitt anew: its box, and the blur itself. The mitt holds
  // still until the catcher reaches for the ball, and meanwhile its kept blur is put down again with nothing read back.
  for (const [name] of runs.slice(1)) {
    rounds.forEach((round, i) => {
      const f = round[name];
      const at = `${name}, round ${i + 1}`;

      expect.soft(f.paints, `${at}: static paints`).toBe(0);
      expect.soft(f.readsMax, `${at}: read-backs in one frame`).toBeLessThanOrEqual(2);
      expect.soft(f.readFrames, `${at}: frames that read back`).toBeLessThanOrEqual(f.frames / 2);
    });
  }
  // Only a coarse backstop, for slow work the counts can't see. The static scene repainted every frame with the fallback
  // filter made frames of 150 ms in Edge and 4.5 s in WebKit, against the mockup's 17 and 100; with the native filter it
  // fit in Edge's frame, and only the count saw it.
  for (const [name] of runs.slice(1)) expect.soft(gap(name), `${name}: frame gap P50`).toBeLessThan(2 * gap('mockup') + 10);
});
