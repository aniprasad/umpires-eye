import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { SHARD_FORMAT } from '../../src/core/schema.ts';
import { seasonMini, type SeasonMini } from '../fixtures/season-mini';
import type { CallKey } from './helpers';
import { activeId, callOf, callPitch, openPaused, trackErrors } from './helpers';

const mini = seasonMini();
const DATA = '/data/season-2026/';
// Every binding gets used, as in round.spec.ts.
const KEYS: readonly CallKey[] = ['S', 'B', 'ArrowRight', 'ArrowLeft', 's', 'b', 'S', 'ArrowLeft', 'ArrowRight', 'B'];
const WORD = { strike: 'Strike', ball: 'Ball' } as const;
const CALL = { S: 'strike', B: 'ball' } as const;
// More page time than the idle callback, or Safari's 2 s stand-in for it, waits before the prefetch (§4.1).
const PAST_IDLE_MS = 5_000;

// Each pitch repaints the static layers for a new stance: 2-5 s of WebKit's time at 2x, about 1 s at 1x. At 2x this round
// took 108 s alone of its 180 s; at 1x, 28 s. Nothing it checks depends on the pixel density.
test.use({ deviceScaleFactor: 1 });

/** Serves a synthetic season in place of the real one, and records every data request, ?v= included. */
async function serveSeason(page: Page, season: SeasonMini = mini): Promise<string[]> {
  const asked: string[] = [];

  await page.route((url) => url.pathname.includes(DATA), (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(url.pathname.indexOf(DATA) + DATA.length);
    const body = season.files.get(path);

    asked.push(path + url.search);

    return body === undefined ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }) : route.fulfill({ json: body });
  });

  return asked;
}

const shards = (asked: readonly string[]): string[] => asked.filter((path) => path.startsWith('shards/'));

/** A data request, with the page's data-ready and #app's data-phase when it was made. */
interface Load {
  readonly path: string;
  readonly ready: string;
  readonly phase: string;
}

/** Records in the page each data request with the app's state at the time, and #app's phase at each parse of a shard. */
async function watchLoads(page: Page): Promise<void> {
  await page.addInitScript(({ data, shard }) => {
    const phase = (): string => document.getElementById('app')?.dataset.phase ?? '';
    const loads: Load[] = [];
    const parses: string[] = [];
    const fetchPage = window.fetch.bind(window);
    const parse = JSON.parse.bind(JSON);

    Object.assign(window, { ueLoads: loads, ueShardParses: parses });
    window.fetch = (input, init) => {
      const { pathname, search } = new URL(input instanceof Request ? input.url : String(input), location.href);
      const at = pathname.indexOf(data);

      if (at >= 0) loads.push({ path: pathname.slice(at + data.length) + search, ready: document.documentElement.dataset.ready ?? '', phase: phase() });

      return fetchPage(input, init);
    };
    JSON.parse = (text, reviver) => {
      if (typeof text === 'string' && text.includes(shard)) parses.push(phase());

      return parse(text, reviver) as unknown;
    };
  }, { data: DATA, shard: SHARD_FORMAT });
}

const loadsOf = (page: Page): Promise<Load[]> => page.evaluate(() => (window as unknown as { ueLoads: Load[] }).ueLoads);
const parsesOf = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { ueShardParses: string[] }).ueShardParses);

/** The device asks for less data, as Chromium reports it. Safari has no navigator.connection, so the init script adds one. */
async function saveData(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  });
}

test("?pool=season&date= plays that day's ten to the card by keyboard, then Another ten from the shard it fetched on the start screen", async ({ page }) => {
  test.setTimeout(180_000);

  const errors = trackErrors(page);
  const app = page.locator('#app');
  const asked = await serveSeason(page);
  const expected = mini.ten.filter((pitch, k) => callOf(KEYS[k]) === CALL[pitch.abs]).length;
  const umpRight = mini.ten.filter((pitch) => pitch.ump === pitch.abs).length;

  expect(mini.ten).toHaveLength(KEYS.length);
  await watchLoads(page);
  await openPaused(page, `./?pool=season&date=${mini.date}`);
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  await expect(page.locator('#startLede')).toHaveText(/^Today's Ten: real pitches from the 2026 season, \d+ of them close calls/);
  // no shard before Play (§4.2), and then the shard's text once the start screen is ready and idle (§4.1)
  await expect.poll(async () => (await loadsOf(page)).length).toBe(3);
  expect(await loadsOf(page)).toEqual([
    { path: 'manifest.json', ready: '', phase: 'boot' },
    { path: 'daily/2026-11.json', ready: '', phase: 'boot' },
    { path: mini.shardUrl, ready: '1', phase: 'start' },
  ]);
  await page.keyboard.press('Enter');

  for (const [k, key] of KEYS.entries()) {
    const n = k + 1;
    const pitch = mini.ten[k];

    await test.step(`pitch ${n}: ${key}`, async () => {
      await expect(app).toHaveAttribute('data-phase', 'pitch');
      await expect(page.locator('#indPitch')).toHaveText(`${n}/10`);
      await expect(page.locator('#muGame')).toHaveText(`${pitch.label} · ${pitch.balls}–${pitch.strikes} count`);
      await callPitch(page, key);
      await expect(app).toHaveAttribute('data-phase', 'reveal');
      await expect(page.locator('#vLine')).toHaveText(new RegExp(`^\\s*You ${WORD[callOf(key)]}`));
      await expect.poll(() => activeId(page)).toBe('btnNext');
      await page.keyboard.press('Space');
    });
  }

  await expect(app).toHaveAttribute('data-phase', 'card');
  await expect(page.locator('#ubCorrect')).toHaveText(String(expected));
  await expect(page.locator('#ubUmp')).toHaveText(`${umpRight}/10`);
  await expect(page.locator('#ubSet')).toHaveText("2026 season set · Today's Ten");
  // the text the start screen fetched is parsed on the card, never during a pitch
  await expect.poll(() => parsesOf(page)).toEqual(['card']);

  await page.locator('#btnAgain').click();
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await expect(page.locator('#scMain')).toHaveText('Another ten');
  expect(mini.deckIds).toContain(await app.getAttribute('data-pitch'));
  expect(shards(asked)).toEqual([mini.shardUrl]);
  expect(await parsesOf(page)).toEqual(['card']);
  await callPitch(page, 'S');
  await expect(app).toHaveAttribute('data-phase', 'reveal');
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});

test('with Save-Data on, the start screen fetches no shard', async ({ page }) => {
  const asked = await serveSeason(page);

  await saveData(page);
  await openPaused(page, `./?pool=season&date=${mini.date}`);
  await page.clock.runFor(PAST_IDLE_MS);
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  expect(asked).toEqual(['manifest.json', 'daily/2026-11.json']);
});

test('with Save-Data on, the card fetches no shard either, and Another ten loads it when pressed', async ({ page }) => {
  const errors = trackErrors(page);
  const app = page.locator('#app');
  const asked = await serveSeason(page);

  await saveData(page);
  await watchLoads(page);
  // the reveal of a round's last pitch, so the card comes as a round ends it
  await openPaused(page, `./?pool=season&date=${mini.date}&state=reveal&i=10`);
  await page.keyboard.press('Space');
  await expect(app).toHaveAttribute('data-phase', 'card');
  await page.clock.runFor(PAST_IDLE_MS);
  expect(shards(asked)).toEqual([]);
  await page.locator('#btnAgain').click();
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  expect(shards(asked)).toEqual([mini.shardUrl]);
  expect(await parsesOf(page)).toEqual(['card']);
  expect(mini.deckIds).toContain(await app.getAttribute('data-pitch'));
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Another ten takes a second shard once the first runs dry, and never deals a pitch it must leave out', async ({ page }) => {
  test.setTimeout(180_000);

  const two = seasonMini({ shards: 2 });
  const errors = trackErrors(page);
  const app = page.locator('#app');
  const asked = await serveSeason(page, two);
  const deckOf = (url: string | undefined): readonly string[] => two.shards.find((s) => s.url === url)?.deckIds ?? [];
  const todayIds = two.ten.map((pitch) => pitch.id);
  const first: string[] = [];

  await watchLoads(page);
  await openPaused(page, `./?pool=season&date=${two.date}&state=card&correct=7`);
  await page.locator('#btnAgain').click();
  for (let n = 1; n <= 10; n++) {
    await test.step(`first ten, pitch ${n}`, async () => {
      await expect(app).toHaveAttribute('data-phase', 'pitch');
      await expect(page.locator('#indPitch')).toHaveText(`${n}/10`);
      first.push((await app.getAttribute('data-pitch')) ?? '');
      await callPitch(page, 'S');
      await expect(app).toHaveAttribute('data-phase', 'reveal');
      await page.keyboard.press('Space');
    });
  }
  await expect(app).toHaveAttribute('data-phase', 'card');
  // each shard holds one ten, so the next press needs the other shard
  await page.locator('#btnAgain').click();
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  const second = (await app.getAttribute('data-pitch')) ?? '';
  const [a, b] = shards(asked);

  expect(shards(asked)).toHaveLength(2);
  expect(a).not.toBe(b);
  expect(new Set(first).size).toBe(10);
  // a shard's deck has only its dealable rows, none held back for Today's Ten
  expect(first.filter((id) => !deckOf(a).includes(id))).toEqual([]);
  expect(first.filter((id) => todayIds.includes(id))).toEqual([]);
  expect(deckOf(b)).toContain(second);
  expect(await parsesOf(page)).toEqual(['card', 'card']);
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});
