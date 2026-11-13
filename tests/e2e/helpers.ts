import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { WS_TODAY_IDS } from '../../src/data/ws2026';
import { BEAT, FIRST_BEAT, WINDUP } from '../../src/math/constants';

export type Call = 'strike' | 'ball';
export type CallKey = 'S' | 's' | 'ArrowRight' | 'B' | 'b' | 'ArrowLeft';

export interface PoolPitch {
  id: string;
  absTruth: Call;
  umpCorrect: boolean;
}

export interface Area {
  width: number;
  height: number;
}

export interface Box extends Area {
  x: number;
  y: number;
}

export interface PhaseMark {
  phase: string;
  t: number;
}

const MOCKUP_HTML = new URL('../../mockup/index.html', import.meta.url);
const POOL_JSON = new URL('../../public/data/ws-2026/pool.json', import.meta.url);
const STRIKE_KEYS: readonly CallKey[] = ['S', 's', 'ArrowRight'];
// Boxes come back in fractional CSS pixels; half a pixel absorbs the rounding without hiding a real overlap.
const SLACK = 0.5;

const fmtBox = (box: Box): string => `${box.width.toFixed(0)}x${box.height.toFixed(0)} at (${box.x.toFixed(0)}, ${box.y.toFixed(0)})`;

// Both apps draw their canvas noise from Math.random, so the same seed gives two pages the same grain.
export async function seedRandom(page: Page, seed = 20261113): Promise<void> {
  await page.addInitScript((start: number) => {
    let a = start >>> 0;

    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;

      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
}

export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', undefined, { timeout: 30_000 });
  // The card art is a plain <img>: a shot taken before it has loaded and decoded shows an empty frame.
  await page.waitForFunction(() => [...document.images].every((img) => {
    const r = img.getBoundingClientRect();
    const onScreen = img.getClientRects().length > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;

    return img.complete || !onScreen;
  }), undefined, { timeout: 15_000 });
  await page.evaluate(async () => {
    const shown = [...document.images].filter((img) => img.complete && img.getClientRects().length > 0);

    await Promise.all(shown.map((img) => img.decode().catch(() => undefined)));
    await document.fonts.ready;
  });
  await nextFrames(page);
}

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    // Browsers ask for /favicon.ico on their own; a 404 for it says nothing about the app.
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  return errors;
}

export function mockupUrl(query: string): string {
  const url = new URL(MOCKUP_HTML);

  url.search = query;

  return url.href;
}

function isPoolPitch(value: unknown): value is PoolPitch {
  if (typeof value !== 'object' || value === null) return false;
  const pitch = value as Record<string, unknown>;

  return typeof pitch.id === 'string' && (pitch.absTruth === 'strike' || pitch.absTruth === 'ball') && typeof pitch.umpCorrect === 'boolean';
}

export function todaysTen(): PoolPitch[] {
  const pool: unknown = JSON.parse(readFileSync(POOL_JSON, 'utf8'));
  const pitches = typeof pool === 'object' && pool !== null ? (pool as { pitches?: unknown }).pitches : undefined;

  if (!Array.isArray(pitches)) throw new Error('public/data/ws-2026/pool.json has no pitches array');
  const byId = new Map<string, PoolPitch>();

  for (const pitch of pitches) if (isPoolPitch(pitch)) byId.set(pitch.id, pitch);

  return Array.from(WS_TODAY_IDS, (id) => {
    const pitch = byId.get(id);

    if (!pitch) throw new Error(`Today's Ten pitch ${id} is missing from public/data/ws-2026/pool.json`);

    return pitch;
  });
}

export function callOf(key: CallKey): Call {
  return STRIKE_KEYS.includes(key) ? 'strike' : 'ball';
}

/**
 * Opens the app with its time on Playwright's clock, stopped once the page is ready. The app keeps all its time on what
 * the clock fakes (performance.now, requestAnimationFrame, timers and Date), so from then on a pitch moves only when the
 * test steps the clock (callPitch), and no delay on a loaded machine can make a call miss its window.
 */
export async function openPaused(page: Page, path: string): Promise<void> {
  await page.clock.install();
  await page.goto(path);
  await waitReady(page);
  // The page's clock starts at the test's wall time and keeps its pace, so a minute from now is still to come.
  await page.clock.pauseAt(Date.now() + 60_000);
}

// The call window runs 1.5 s past the catch, so a press within a step of the release lands early in it.
const RELEASE_STEP_MS = 200;
// A pitch is released WINDUP s after its beat, and the first pitch of a round waits a longer beat. One jump lands just
// past the earlier of the two releases: a later pitch is released by then, and the first is a few steps short of it.
const TO_RELEASE_MS = Math.round((Math.min(BEAT, FIRST_BEAT) + WINDUP) * 1000) + 100;
// A verdict takes two steps at least: the first passes the moment the reveal starts, the second the moment its body shows.
const VERDICT_STEP_MS = 1000;
// More steps than the release or the verdict needs.
const CLOCK_STEPS_MAX = 20;

async function stepClockUntil(page: Page, stepMs: number, done: () => Promise<boolean>, what: string): Promise<void> {
  for (let k = 0; k < CLOCK_STEPS_MAX; k++) {
    if (await done()) return;
    await page.clock.fastForward(stepMs);
  }

  throw new Error(`${what} didn't come within ${(CLOCK_STEPS_MAX * stepMs) / 1000} s of page time`);
}

/**
 * Calls the pitch in play on a page opened with openPaused, as the pitch begins. It jumps the clock to the release and
 * steps on until it comes, presses the key or the button once, checks the call was taken, then steps on until the
 * verdict has settled. Every step paints a frame, which WebKit takes a quarter of a second over, so the steps are few.
 */
export async function callPitch(page: Page, input: CallKey | Locator, options: { tap?: boolean } = {}): Promise<void> {
  const button = typeof input === 'string' ? page.locator(callOf(input) === 'strike' ? '#btnStrike' : '#btnBall') : input;

  await page.clock.fastForward(TO_RELEASE_MS);
  // The call clock's bar stays full until the release, then drains.
  await stepClockUntil(page, RELEASE_STEP_MS, async () => (await page.locator('#indClock').evaluate((el) => (el as HTMLElement).style.transform)) !== 'scaleX(1)', 'The release');
  if (typeof input === 'string') await page.keyboard.press(input);
  else if (options.tap) await input.tap({ timeout: 5_000 });
  else await input.click({ timeout: 5_000 });
  await expect(button, 'the call was taken').toHaveClass(/\bis-called\b/);
  await page.clock.fastForward(VERDICT_STEP_MS);
  await page.clock.fastForward(VERDICT_STEP_MS);
  await stepClockUntil(page, VERDICT_STEP_MS, () => page.locator('#verdict').evaluate((el) => el.classList.contains('show-body')), 'The verdict');
}

export async function activeId(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.id ?? '');
}

// The page's own clock times the phase changes, free of the test's polling delays.
export async function recordPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = document.getElementById('app');
    const marks: PhaseMark[] = [];

    Object.assign(window, { uePhases: marks });
    if (!app) return;
    marks.push({ phase: app.dataset.phase ?? '', t: performance.now() });
    new MutationObserver(() => marks.push({ phase: app.dataset.phase ?? '', t: performance.now() })).observe(app, { attributes: true, attributeFilter: ['data-phase'] });
  });
}

export async function phaseMarks(page: Page): Promise<PhaseMark[]> {
  return page.evaluate(() => (window as unknown as { uePhases?: PhaseMark[] }).uePhases ?? []);
}

export function secondsBetween(marks: PhaseMark[], from: string, to: string): number {
  const start = marks.find((mark) => mark.phase === from);
  const end = start ? marks.find((mark) => mark.t >= start.t && mark.phase === to) : undefined;

  if (!start || !end) throw new Error(`No ${from} -> ${to} change among ${JSON.stringify(marks)}`);

  return (end.t - start.t) / 1000;
}

export function slugOf(query: string): string {
  return query.replace(/^state=/, '').replace(/[^\w.-]+/g, '-');
}

export async function attachShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);

  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

export function viewportOf(page: Page): Area {
  const size = page.viewportSize();

  if (!size) throw new Error('The page has no fixed viewport');

  return size;
}

export async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).boundingBox();

  if (!box) throw new Error(`${selector} is not visible`);

  return box;
}

export function expectInside(box: Box, area: Area, label: string): void {
  const inside = box.x >= -SLACK && box.y >= -SLACK && box.x + box.width <= area.width + SLACK && box.y + box.height <= area.height + SLACK;

  expect.soft(inside, `${label} (${fmtBox(box)}) lies inside the ${area.width}x${area.height} viewport`).toBe(true);
}

export function expectApart(a: Box, b: Box, label: string): void {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);

  expect.soft(overlapX <= SLACK || overlapY <= SLACK, `${label} stay apart (${fmtBox(a)}; ${fmtBox(b)})`).toBe(true);
}

export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // The document never scrolls, so anything wider than the screen shows up as overflow of the app or of the two
    // overlays that scroll on their own.
    const scrollers: Array<[string, Element | null]> = [
      ['html', document.documentElement],
      ['body', document.body],
      ['#app', document.getElementById('app')],
      ['#start', document.getElementById('start')],
      ['#cards', document.getElementById('cards')],
    ];

    return scrollers.flatMap(([name, el]) => (el && el.scrollWidth > el.clientWidth + 1 ? [`${name} is ${el.scrollWidth} px wide in ${el.clientWidth} px`] : []));
  });
}

// Counts the distinct opaque colours in a coarse sample of #scene: an unpainted canvas gives 0, a flat fill 1.
export async function sceneColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scene = document.getElementById('scene');
    const probe = document.createElement('canvas');
    const g = probe.getContext('2d');

    if (!(scene instanceof HTMLCanvasElement) || !g || scene.width === 0 || scene.height === 0) return 0;
    probe.width = 16;
    probe.height = 10;
    g.drawImage(scene, 0, 0, probe.width, probe.height);
    const { data } = g.getImageData(0, 0, probe.width, probe.height);
    const colours = new Set<number>();

    for (let i = 0; i < data.length; i += 4) if (data[i + 3] === 255) colours.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);

    return colours.size;
  });
}

export async function noteCanvasFilter(page: Page, testInfo: TestInfo): Promise<void> {
  const mode = await page.evaluate(() => document.documentElement.dataset.canvasFilter ?? '(unset)');

  testInfo.annotations.push({ type: 'canvasFilter', description: mode });
}
