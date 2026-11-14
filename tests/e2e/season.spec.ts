import { expect, test } from '@playwright/test';
import { seasonMini } from '../fixtures/season-mini';
import type { CallKey } from './helpers';
import { activeId, callOf, callPitch, openPaused, trackErrors, waitReady } from './helpers';
import { hold, loadsOf, mini, PAST_IDLE_MS, parsesOf, saveData, serveSeason, shards, watchLoads } from './season-data';

// Every binding gets used, as in round.spec.ts.
const KEYS: readonly CallKey[] = ['S', 'B', 'ArrowRight', 'ArrowLeft', 's', 'b', 'S', 'ArrowLeft', 'ArrowRight', 'B'];
const WORD = { strike: 'Strike', ball: 'Ball' } as const;
const CALL = { S: 'strike', B: 'ball' } as const;
// the ump figure, from the synthetic stats, to one decimal as the app shows it (§5.4)
const FIG = Math.round((mini.files.get('stats.json') as { umpVsAbs: { overall: { pct: number } } }).umpVsAbs.overall.pct * 10) / 10;
const CITE = `MLB umps ${FIG}%, season overall: agreement with our ABS reconstruction on 2026 called pitches.`;

// Each pitch repaints the static layers for a new stance: 2-5 s of WebKit's time at 2x, about 1 s at 1x. At 2x this round
// took 108 s alone of its 180 s; at 1x, 28 s. Nothing it checks depends on the pixel density.
test.use({ deviceScaleFactor: 1 });

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
  await expect(page.locator('#startLede')).toHaveText(/^Today's Ten for November 14, 2026: real pitches from the 2026 season, \d+ of them close calls/);
  await expect(page.locator('#hook')).toHaveText(`MLB umpires got ${FIG}% of calls right this season. Can you?`);
  await expect(page.locator('.footnote')).toContainText(`tracking data. ${CITE} Players`, { useInnerText: true });
  await expect(page.locator('#scSub .sc-long')).toHaveText(`Close calls · MLB umps ${FIG}% season overall`);
  // the manifest, the month file and the stats while the page boots, and no shard before Play (§4.1, §4.2); then the
  // shard's text, once the start screen is ready and idle
  await expect.poll(async () => (await loadsOf(page)).length).toBe(4);
  const loads = await loadsOf(page);

  expect(loads.slice(0, 3).map((load) => load.path).sort()).toEqual(['daily/2026-11.json', 'manifest.json', 'stats.json']);
  expect(loads.slice(0, 3).every((load) => load.ready === '' && load.phase === 'boot')).toBe(true);
  expect(loads[3]).toEqual({ path: mini.shardUrl, ready: '1', phase: 'start' });
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
      if (n === 1) await expect(page.locator('#vScore')).toHaveText(new RegExp(` · MLB umps ${FIG}% season overall$`));
      await expect.poll(() => activeId(page)).toBe('btnNext');
      await page.keyboard.press('Space');
    });
  }

  await expect(app).toHaveAttribute('data-phase', 'card');
  await expect(page.locator('#ubCorrect')).toHaveText(String(expected));
  await expect(page.locator('#ubUmp')).toHaveText(`${umpRight}/10`);
  await expect(page.locator('#ubSet')).toHaveText('2026 season set · November 14, 2026');
  await expect(page.locator('#ucSet')).toHaveText('2026 season');
  await expect(page.locator('#ubFig')).toHaveText(`${FIG}%`);
  await expect(page.locator('#ubFoot')).toHaveText(`${CITE} The real ump: original calls vs ABS on these pitches.`);
  // the World Series' footnote counts its real challenges; the season's has no such count
  await expect(page.locator('.cards-foot')).toContainText('ABS truth reconstructed from tracking data. Players', { useInnerText: true });
  // The card paints before the text the start screen fetched is parsed: the parse waits until the page is idle, and the
  // paused clock keeps it from being idle until the test runs it. It's never parsed during a pitch.
  expect(await parsesOf(page)).toEqual([]);
  await page.clock.runFor(PAST_IDLE_MS);
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
  expect([...asked].sort()).toEqual(['daily/2026-11.json', 'manifest.json', 'stats.json']);
});

test("without requestIdleCallback, as in Safari, a Play before the 2 s stand-in fetches no shard during the pitch", async ({ page }) => {
  await serveSeason(page);
  await watchLoads(page);
  // Playwright's clock adds a requestIdleCallback of its own. A page's init scripts run after the clock's.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'requestIdleCallback', { value: undefined, configurable: true, writable: true });
  });
  await page.clock.install();
  // paused before the page loads, so none of the stand-in's 2 s can pass before the press
  await page.clock.pauseAt(Date.now() + 1_000);
  await page.goto(`./?pool=season&date=${mini.date}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
  await page.clock.runFor(PAST_IDLE_MS);
  expect((await loadsOf(page)).filter((load) => load.path.startsWith('shards/'))).toEqual([]);
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

test('without the stats, the copy leaves the ump figure out, and play goes on', async ({ page }) => {
  const errors: string[] = [];
  const notFound: string[] = [];
  const noStats = { ...mini, files: new Map([...mini.files].filter(([path]) => path !== 'stats.json')) };

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // The stats are asked for and missing. That 404, once per page, is expected, and nothing else.
    if (message.location().url.endsWith('/data/season-2026/stats.json')) notFound.push(message.text());
    else errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await serveSeason(page, noStats);
  await page.goto(`./?date=${mini.date}`);
  await waitReady(page);
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  await expect(page.locator('#hook')).toHaveText('Can you call balls and strikes like an MLB umpire?');
  await expect(page.locator('#scSub .sc-long')).toHaveText('Close calls');
  await expect(page.locator('.footnote')).toContainText('tracking data. Players', { useInnerText: true });
  await page.goto(`./?date=${mini.date}&state=card&correct=7`);
  await waitReady(page);
  await expect(page.locator('#ubFigRow')).toBeHidden();
  await expect(page.locator('#ubFoot')).toHaveText('The real ump: original calls vs ABS on these pitches.');
  await expect(page.locator('#err')).toBeHidden();
  expect(notFound).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('a card that is up before the stats arrive takes the ump figure when they do', async ({ page }) => {
  const errors = trackErrors(page);

  await serveSeason(page);
  const release = await hold(page, 'stats.json');

  await page.goto(`./?date=${mini.date}&state=card&correct=7`);
  await waitReady(page);
  await expect(page.locator('#ubFigRow')).toBeHidden();
  await expect(page.locator('#ubFoot')).toHaveText('The real ump: original calls vs ABS on these pitches.');
  release();
  await expect(page.locator('#ubFigRow')).toBeVisible();
  await expect(page.locator('#ubFig')).toHaveText(`${FIG}%`);
  await expect(page.locator('#ubFoot')).toHaveText(`${CITE} The real ump: original calls vs ABS on these pitches.`);
  expect(errors).toEqual([]);
});
