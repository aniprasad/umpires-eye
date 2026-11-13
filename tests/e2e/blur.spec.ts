import { readFileSync } from 'node:fs';
import { chromium, expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { fromPoolFile, type PoolFile } from '../../src/data/ws2026';
import { catcherRig } from '../../src/math/catcher';
import { playPoints } from '../../src/math/deal';
import { dofBlur } from '../../src/math/dof';
import { prep } from '../../src/math/kinematics';
import { createLens } from '../../src/math/lens';
import { eyeOf } from '../../src/math/stance';
import { mockupUrl, seedRandom, trackErrors, waitReady } from './helpers';

// Pitch 8 of Today's Ten (a right-hander) frozen in the windup: the catcher's helmet rises out of the bottom edge on the
// side away from the batter. Its top edge is the scene's strongest defocused edge, against the lit infield.
const PITCH = 8;
const QUERY = `state=pitch&i=${PITCH}&t=-0.6`;
// Rows of the strip at the top and bottom that set the infield and helmet levels.
const LEVEL_ROWS = 0.12;
// Levels any row of the frame foot may drift from Edge native. Clipping the blur at the frame edge put the worst row
// 21-25 levels off, the infield showing through the helmet; blurring in what's past the edge brings it under 2.
const FOOT_GAP = 4;

interface Strip {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The lens blur at the helmet, CSS px. */
  sigma: number;
}

interface Edge {
  dpr: number;
  filter: string;
  /** Luminance per row of canvas pixels, averaged across the strip. */
  profile: number[];
  /** Mean luminance of the infield above the edge and of the helmet below it. */
  field: number;
  helmet: number;
  /** 25-75% rise of the edge, CSS px. */
  spread: number;
}

const pool = JSON.parse(readFileSync(new URL('../../public/data/ws-2026/pool.json', import.meta.url), 'utf8')) as PoolFile;
const data = fromPoolFile(pool);
const lens = createLens(playPoints(data.today, data.pitches));

/** A 40 px column strip across the top edge of the catcher's helmet, from the same math the renderer uses. */
function helmetStrip(W: number, H: number): Strip {
  const P = prep(data.today[PITCH - 1]);
  const cam = lens.camFor(W, H, P);
  const m = catcherRig(P.batter.side, eyeOf(P));
  const q = cam.p(m.head);
  const top = q.y - m.r * q.k;
  const sigma = Math.max(2, dofBlur(cam, q.d));

  return { x0: Math.round(q.x - 20), x1: Math.round(q.x + 20), y0: Math.round(top - 3 * sigma), y1: Math.min(H, Math.round(top + 3 * sigma)), sigma };
}

async function open(page: Page, query: string): Promise<void> {
  await seedRandom(page);
  await page.goto(`./?${query}`);
  await waitReady(page);
}

async function measureEdge(page: Page, s: Strip): Promise<Edge> {
  const { dpr, filter, profile } = await page.evaluate((s) => {
    const c = document.getElementById('scene') as HTMLCanvasElement;
    const dpr = c.width / innerWidth;
    const x0 = Math.round(s.x0 * dpr);
    const y0 = Math.round(s.y0 * dpr);
    const img = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(x0, y0, Math.round(s.x1 * dpr) - x0, Math.round(s.y1 * dpr) - y0);
    const rows: number[] = [];

    for (let y = 0; y < img.height; y++) {
      let sum = 0;

      for (let x = 0; x < img.width; x++) {
        const i = 4 * (y * img.width + x);

        sum += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      }
      rows.push(sum / img.width);
    }

    return { dpr, filter: document.documentElement.dataset.canvasFilter ?? '', profile: rows };
  }, s);
  const n = Math.max(1, Math.round(profile.length * LEVEL_ROWS));
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const field = mean(profile.slice(0, n));
  const helmet = mean(profile.slice(-n));
  const below = (f: number): number => profile.findIndex((v) => v < field - f * (field - helmet));

  return { dpr, filter, profile, field, helmet, spread: (below(0.75) - below(0.25)) / dpr };
}

const rms = (a: number[], b: number[]): number => Math.sqrt(a.reduce((m, v, i) => m + (v - b[i]) ** 2, 0) / a.length);

/**
 * Mean colour per row of the strip's columns over the bottom 3 sigma of the frame. The helmet runs off the bottom
 * edge there, and a blur that ignores what's drawn past the edge lets the infield show through it.
 */
async function frameFoot(page: Page, s: Strip): Promise<number[][]> {
  return page.evaluate((s) => {
    const c = document.getElementById('scene') as HTMLCanvasElement;
    const dpr = c.width / innerWidth;
    const x0 = Math.round(s.x0 * dpr);
    const y0 = Math.round((innerHeight - 3 * s.sigma) * dpr);
    const img = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(x0, y0, Math.round(s.x1 * dpr) - x0, c.height - y0);
    const rows: number[][] = [];

    for (let y = 0; y < img.height; y++) {
      const sum = [0, 0, 0];

      for (let x = 0; x < img.width; x++) {
        for (let k = 0; k < 3; k++) sum[k] += img.data[4 * (y * img.width + x) + k];
      }
      rows.push(sum.map((v) => v / img.width));
    }

    return rows;
  }, s);
}

/** The largest gap between two row profiles, in any channel of any row. */
const worstRow = (a: number[][], b: number[][]): number => Math.max(...a.map((row, y) => Math.max(...row.map((v, k) => Math.abs(v - b[y][k])))));

/** Edge with its native canvas filter, at the page's size and density: the reference every engine is held to. */
async function nativeReference(page: Page, s: Strip, baseURL: string | undefined): Promise<{ edge: Edge; foot: number[][] }> {
  const size = page.viewportSize();
  const dpr = await page.evaluate(() => devicePixelRatio);
  const browser: Browser = await chromium.launch(process.env.CI ? {} : { channel: 'msedge' });

  try {
    const context = await browser.newContext({ baseURL, viewport: size, deviceScaleFactor: dpr });
    const ref = await context.newPage();

    await open(ref, QUERY);

    return { edge: await measureEdge(ref, s), foot: await frameFoot(ref, s) };
  } finally {
    await browser.close();
  }
}

test('the lens defocuses the catcher whichever way the engine draws it', async ({ page, baseURL }, testInfo) => {
  const errors = trackErrors(page);
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const s = helmetStrip(size.width, size.height);

  await open(page, QUERY);
  const edge = await measureEdge(page, s);
  const foot = await frameFoot(page, s);
  const { edge: ref, foot: refFoot } = await nativeReference(page, s, baseURL);
  const diff = rms(edge.profile, ref.profile);
  const footGap = worstRow(foot, refFoot);

  testInfo.annotations.push(
    { type: 'canvasFilter', description: edge.filter },
    { type: 'helmet edge', description: `25-75% rise ${edge.spread.toFixed(1)} px for a lens blur of ${s.sigma.toFixed(1)} px (Edge native ${ref.spread.toFixed(1)} px); infield ${edge.field.toFixed(1)} and helmet ${edge.helmet.toFixed(1)} levels (Edge native ${ref.field.toFixed(1)} and ${ref.helmet.toFixed(1)}); profile RMS against Edge ${diff.toFixed(2)} levels` },
    { type: 'frame foot', description: `helmet where it runs off the bottom: worst row ${footGap.toFixed(1)} levels from Edge native` },
  );
  expect(['native', 'fallback']).toContain(edge.filter);
  // a Gaussian of sigma s rises 25-75% over 1.35 s; an unblurred edge would rise in a pixel or two
  expect(edge.spread).toBeGreaterThan(0.8 * s.sigma);
  expect(edge.spread).toBeLessThan(2 * s.sigma);
  expect(diff).toBeLessThan(3);
  expect(footGap).toBeLessThan(FOOT_GAP);
  expect(errors).toEqual([]);
});

test('the forced fallback blur matches the native canvas filter', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Only Chromium has the native filter to compare against.');
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const s = helmetStrip(size.width, size.height);

  await open(page, QUERY);
  const native = await measureEdge(page, s);
  const nativeFoot = await frameFoot(page, s);

  await open(page, `${QUERY}&canvasFilter=fallback`);
  const fallback = await measureEdge(page, s);
  const footGap = worstRow(await frameFoot(page, s), nativeFoot);
  const diff = rms(fallback.profile, native.profile);
  const frame = await page.evaluate(() => {
    const c = document.getElementById('scene') as HTMLCanvasElement;

    return { w: c.width, h: c.height };
  });

  testInfo.annotations.push({ type: 'fallback vs native', description: `rise ${fallback.spread.toFixed(1)} vs ${native.spread.toFixed(1)} px; profile RMS ${diff.toFixed(2)} levels at ${frame.w}x${frame.h}; frame foot worst row ${footGap.toFixed(1)} levels` });
  expect(native.filter).toBe('native');
  expect(fallback.filter).toBe('fallback');
  expect(Math.abs(fallback.spread - native.spread)).toBeLessThan(0.2 * native.spread);
  expect(diff).toBeLessThan(2);
  expect(footGap).toBeLessThan(FOOT_GAP);
});

interface FrameStats {
  frames: number;
  costP50: number;
  costP95: number;
  costMax: number;
  gapP50: number;
  gapP95: number;
}

type Frames = { costs: number[]; stamps: number[] };

/** Times every animation frame callback the page runs: its script cost, and when it ran. */
async function timeFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const frames = { costs: [] as number[], stamps: [] as number[] };

    Object.assign(window, { ueFrames: frames });
    window.requestAnimationFrame = (cb) => raf((t) => {
      const t0 = performance.now();

      cb(t);
      frames.costs.push(performance.now() - t0);
      frames.stamps.push(t);
    });
  });
}

/** One live pitch from "Play ball" through the reveal. */
async function pitchFrames(page: Page, url: string): Promise<FrameStats> {
  await page.goto(url);
  await waitReady(page);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const f = (window as unknown as { ueFrames: Frames }).ueFrames;

    f.costs.length = 0;
    f.stamps.length = 0;
  });
  await page.waitForTimeout(6000);
  const { costs, stamps } = await page.evaluate(() => (window as unknown as { ueFrames: Frames }).ueFrames);
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
  // Headless frame times are indicative only. This bound catches a filter redone in full every frame.
  for (const [name] of runs.slice(1)) expect(gap(name), name).toBeLessThan(1.25 * gap('mockup') + 2);
});
