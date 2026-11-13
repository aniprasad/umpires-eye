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
}

type Frames = { costs: number[]; stamps: number[]; start: number };

/** Times every animation frame callback the page runs, its script cost and when it ran, since the last "Play ball". */
async function timeFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const frames = { costs: [] as number[], stamps: [] as number[], start: 0 };

    Object.assign(window, { ueFrames: frames });
    addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      frames.costs.length = 0;
      frames.stamps.length = 0;
      frames.start = performance.now();
    }, true);
    window.requestAnimationFrame = (cb) => raf((t) => {
      const t0 = performance.now();

      cb(t);
      frames.costs.push(performance.now() - t0);
      frames.stamps.push(t);
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
  const { costs, stamps } = await page.evaluate(([ms, n]) => new Promise<Frames>((resolve) => {
    const f = (window as unknown as { ueFrames: Frames }).ueFrames;
    const check = (): void => {
      if (performance.now() - f.start >= ms && f.stamps.length >= n) resolve(f);
      else setTimeout(check, 50);
    };

    check();
  }), [SAMPLE_MS, MIN_FRAMES] as const);
  const pct = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
  const gaps = [...new Set(stamps)].sort((a, b) => a - b).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1);

  return { frames: costs.length, costP50: pct(costs, 0.5), costP95: pct(costs, 0.95), costMax: Math.max(...costs), gapP50: pct(gaps, 0.5), gapP95: pct(gaps, 0.95) };
}

const fmtFrames = (f: FrameStats): string => `${f.frames} frames; script per frame P50 ${f.costP50.toFixed(2)} ms, P95 ${f.costP95.toFixed(2)} ms, max ${f.costMax.toFixed(1)} ms; frame gap P50 ${f.gapP50.toFixed(1)} ms, P95 ${f.gapP95.toFixed(1)} ms`;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
// The runs take turns, one pitch each per round, so load that comes and goes on a shared machine falls on every run
// alike, and the medians over the rounds compare like with like. Two windows taken one after the other did neither.
const SPEED_ROUNDS = 3;

test('a live pitch with the fallback filter runs about as fast as the mockup in the same engine', async ({ page, baseURL, browserName }, testInfo) => {
  test.setTimeout(120_000);
  // The mockup sets canvas filters and, where the engine ignores them (WebKit), simply goes without its blurs:
  // the frame time of the same scene with no defocus at all.
  const runs: [string, string][] = [['mockup', mockupUrl('')], ['port, fallback filter', new URL('./?canvasFilter=fallback', baseURL).href]];

  if (browserName === 'chromium') runs.push(['port, native filter', new URL('./', baseURL).href]);
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
  // Headless frame times are indicative only. This bound catches the static scene's blurs redone every frame. It can't
  // see the mitt's cached blur redone instead of reused, a few ms of script that moves no frame gap here; M3 guards that.
  for (const [name] of runs.slice(1)) expect(gap(name), name).toBeLessThan(1.25 * gap('mockup') + 2);
});
