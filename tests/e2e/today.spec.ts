// Today's Ten keeps to the local date (docs/M2-DESIGN.md §2.2), and a date without one offers Another ten (NoToday, §5.1).
// The pages run on Playwright's clock, set to the instant each test names, in the time zone it names.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seasonMini } from '../fixtures/season-mini';
import { activeId, callPitch, trackErrors } from './helpers';
import { loadsOf, PAST_IDLE_MS, parsesOf, saveData, serveSeason, shards, textsOf, watchLoads } from './season-data';

const cal = seasonMini({ calendar: true });
const tenOf = (date: string): string => {
  const ids = cal.days.get(date);

  if (!ids) throw new Error(`the calendar has no ten for ${date}`);

  return ids.join(' ');
};

// Each pitch repaints the static layers for a new stance, which takes WebKit seconds at 2x. Nothing here depends on the
// pixel density.
test.use({ deviceScaleFactor: 1 });

/** Opens the app at an instant on a stopped clock, before the page loads, so no time passes until the test moves it. */
async function openAt(page: Page, at: string, query = ''): Promise<void> {
  const instant = new Date(at).getTime();

  await page.clock.install({ time: instant - 1_000 });
  await page.clock.pauseAt(instant);
  await page.goto(`./${query}`);
}

/** The start screen offers the date's ten, ready to play. */
async function expectTen(page: Page, date: string): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('html')).toHaveAttribute('data-date', date);
  await expect(page.locator('#app')).toHaveAttribute('data-ten', tenOf(date));
}

const dailyAsked = (asked: readonly string[]): string[] => asked.filter((path) => path.startsWith('daily/'));

test.describe('in Los Angeles', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('the date is the local one: at 06:00 UTC on November 14, it is still November 13', async ({ page }) => {
    const errors = trackErrors(page);

    await serveSeason(page, cal);
    await openAt(page, '2026-11-14T06:00:00Z');
    await expectTen(page, '2026-11-13');
    await expect(page.locator('#startLede')).toHaveText(/^Today's Ten for November 13, 2026: real pitches from the 2026 season, \d+ of them close calls/);
    expect(errors).toEqual([]);
  });

  test("the start screen moves to the new date's ten at midnight, and not a second before", async ({ page }) => {
    const errors = trackErrors(page);

    expect(tenOf('2026-11-14')).not.toBe(tenOf('2026-11-13'));
    await serveSeason(page, cal);
    await openAt(page, '2026-11-13T23:59:00-08:00');
    await expectTen(page, '2026-11-13');
    await page.clock.fastForward(59_000);
    await expectTen(page, '2026-11-13');
    await page.clock.fastForward(1_000);
    await expectTen(page, '2026-11-14');
    await expect(page.locator('#startLede')).toHaveText(/^Today's Ten for November 14, 2026:/);
    await expect(page.locator('#btnPlay')).toHaveText('Play ball');
    await expect(page.locator('#btnPlay')).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test("Play after a midnight the page missed loads the new date's ten first, then plays it", async ({ page }) => {
    const errors = trackErrors(page);
    const app = page.locator('#app');

    await serveSeason(page, cal);
    await openAt(page, '2026-11-13T23:59:00-08:00');
    await expectTen(page, '2026-11-13');
    // as when a device sleeps through midnight: the time moves on, and no timer fires
    await page.clock.setSystemTime(new Date('2026-11-14T00:05:00-08:00'));
    await expectTen(page, '2026-11-13');
    await page.keyboard.press('Enter');
    await expect(app).toHaveAttribute('data-phase', 'pitch');
    await expect(page.locator('html')).toHaveAttribute('data-date', '2026-11-14');
    await expect(app).toHaveAttribute('data-pitch', tenOf('2026-11-14').split(' ')[0] ?? '');
    expect(errors).toEqual([]);
  });

  test('a round keeps the date it began on, through midnight to its card and its copied result', async ({ page }) => {
    test.setTimeout(180_000);

    const errors = trackErrors(page);
    const app = page.locator('#app');

    await page.addInitScript(() => {
      const writeText = async (text: string): Promise<void> => {
        Object.assign(window, { ueCopied: text });
      };

      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    await serveSeason(page, cal);
    await openAt(page, '2026-11-13T23:59:30-08:00');
    await expectTen(page, '2026-11-13');
    await page.keyboard.press('Enter');
    for (let n = 1; n <= 10; n++) {
      await test.step(`pitch ${n}`, async () => {
        await expect(app).toHaveAttribute('data-phase', 'pitch');
        await callPitch(page, 'S');
        await expect.poll(() => activeId(page)).toBe('btnNext');
        await page.keyboard.press('Space');
      });
    }
    await expect(app).toHaveAttribute('data-phase', 'card');
    expect(await page.evaluate(() => new Date().getDate())).toBe(14);
    await expect(page.locator('#ubSet')).toHaveText('2026 season set · November 13, 2026');
    await expect(page.locator('html')).toHaveAttribute('data-date', '2026-11-13');
    await page.locator('#btnCopy').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { ueCopied?: string }).ueCopied?.split('\n')[0]))
      .toBe("Umpire's Eye · 2026 season · Today's Ten · November 13, 2026");
    expect(errors).toEqual([]);
  });

  test('November 1 lasts 25 hours: at 11:30 pm it is still November 1, and at midnight November 2', async ({ page }) => {
    await serveSeason(page, cal);
    // 00:30 daylight time; the clocks go back at 2:00
    await openAt(page, '2026-11-01T00:30:00-07:00');
    await expectTen(page, '2026-11-01');
    await page.clock.fastForward(24 * 3_600_000);
    await expectTen(page, '2026-11-01');
    await page.clock.fastForward(30 * 60_000);
    await expectTen(page, '2026-11-02');
  });

  test('a page that comes back into view, or back from the back-forward cache, after a midnight it slept through moves to the new date', async ({ page }) => {
    const errors = trackErrors(page);

    await serveSeason(page, cal);
    await openAt(page, '2026-11-13T23:59:00-08:00');
    await expectTen(page, '2026-11-13');
    // the time moves on, and no timer fires
    await page.clock.setSystemTime(new Date('2026-11-14T00:05:00-08:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expectTen(page, '2026-11-14');
    await page.clock.setSystemTime(new Date('2026-11-16T00:05:00-08:00'));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expectTen(page, '2026-11-16');
    expect(errors).toEqual([]);
  });

  test("a new month's first midnight reads the new month's file, and Play waits for it, saying so", async ({ page }) => {
    const play = page.locator('#btnPlay');
    const asked = await serveSeason(page, cal);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Routes run newest first, so December's file waits here before the season serves it.
    await page.route((url) => url.pathname.endsWith('/data/season-2026/daily/2026-12.json'), async (route) => {
      await held;
      await route.fallback();
    });
    await openAt(page, '2026-11-30T23:59:00-08:00');
    await expectTen(page, '2026-11-30');
    expect(dailyAsked(asked)).toEqual(['daily/2026-11.json']);
    await page.clock.fastForward(60_000);
    await expect(play).toBeDisabled();
    await expect(play).toHaveText("Loading today's pitches");
    await expect(page.locator('html')).not.toHaveAttribute('data-ready');
    release();
    await expectTen(page, '2026-12-01');
    await expect(play).toBeEnabled();
    await expect(play).toHaveText('Play ball');
    expect(dailyAsked(asked)).toEqual(['daily/2026-11.json', 'daily/2026-12.json']);
  });

  test('Play after a midnight into a date without a ten shows NoToday, which waits for its own press', async ({ page }) => {
    const errors = trackErrors(page);

    await serveSeason(page, cal);
    await watchLoads(page);
    await openAt(page, '2026-11-14T23:59:00-08:00');
    await expectTen(page, '2026-11-14');
    await page.clock.setSystemTime(new Date(`${cal.unavailableDate}T00:05:00-08:00`));
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
    await expect(page.locator('#btnPlay')).toHaveText('Play another ten');
    // Another ten's shard is in, and still no round has started from it
    await expect.poll(() => textsOf(page)).toEqual(['start']);
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'start');
    expect(await parsesOf(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('at midnight, NoToday gives way to the next date that has a ten', async ({ page }) => {
    await serveSeason(page, cal);
    await openAt(page, `${cal.unavailableDate}T23:59:00-08:00`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
    await page.clock.fastForward(60_000);
    await expectTen(page, '2026-11-16');
    await expect(page.locator('.indicator')).toBeVisible();
  });

  test('?date= keeps its date when midnight comes, and when Play is pressed', async ({ page }) => {
    await serveSeason(page, cal);
    await openAt(page, '2026-11-13T23:59:00-08:00', '?date=2026-11-20');
    await expectTen(page, '2026-11-20');
    await page.clock.fastForward(120_000);
    await expectTen(page, '2026-11-20');
    await page.keyboard.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-pitch', tenOf('2026-11-20').split(' ')[0] ?? '');
  });
});

test.describe('in Tokyo', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });

  test('the date is the local one: at 06:00 UTC on November 14, it is November 14', async ({ page }) => {
    await serveSeason(page, cal);
    await openAt(page, '2026-11-14T06:00:00Z');
    await expectTen(page, '2026-11-14');
  });
});

test.describe('NoToday', () => {
  test('past the schedule, the start screen offers Another ten, loads its shard at once, and plays it', async ({ page }) => {
    const errors: string[] = [];
    const notFound: string[] = [];
    const app = page.locator('#app');
    const play = page.locator('#btnPlay');

    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // A month file's address follows from its date, so it's asked for alongside the manifest (§4.1), and past the
      // schedule the browser reports its 404. That one, and only that one, is expected.
      if (message.location().url.endsWith('/data/season-2026/daily/2027-01.json')) notFound.push(message.text());
      else errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    const asked = await serveSeason(page, cal);

    await page.goto('./?date=2027-01-01');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
    await expect(page.locator('#startLede')).toHaveText("There's no Today's Ten for January 1, 2027. Another ten deals fresh pitches from the 2026 season.");
    await expect(play).toHaveText('Play another ten');
    await expect(play).toBeEnabled();
    await expect(play).toBeFocused();
    await expect(app).toHaveAttribute('data-ten', 'none');
    await expect(page.locator('.indicator')).toBeHidden();
    await expect(page.locator('#btnStrike')).toBeHidden();
    await expect(page.locator('#err')).toBeHidden();
    // Another ten is all there is to play, so its shard loads before the press (§4.1)
    await expect.poll(() => shards(asked)).toEqual([cal.shardUrl]);
    expect(dailyAsked(asked)).toEqual(['daily/2027-01.json']);
    await page.keyboard.press('Enter');
    await expect(app).toHaveAttribute('data-phase', 'pitch');
    await expect(page.locator('#start')).toBeHidden();
    await expect(page.locator('#scMain')).toHaveText('Another ten');
    expect(cal.deckIds).toContain(await app.getAttribute('data-pitch'));
    expect(notFound).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('a date whose ten became unavailable shows NoToday too, with no error', async ({ page }) => {
    const errors = trackErrors(page);

    await serveSeason(page, cal);
    await page.goto(`./?date=${cal.unavailableDate}`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
    await expect(page.locator('#startLede')).toHaveText("There's no Today's Ten for November 15, 2026. Another ten deals fresh pitches from the 2026 season.");
    await expect(page.locator('#err')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('NoToday parses the shard it loaded only when Play another ten is pressed, so the parse never holds up its first paint', async ({ page }) => {
    const errors = trackErrors(page);
    const asked = await serveSeason(page, cal);

    await watchLoads(page);
    await openAt(page, '2026-11-15T12:00:00Z', `?date=${cal.unavailableDate}`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
    await expect.poll(() => textsOf(page)).toEqual(['start']);
    // the text is in and the page has had time to be idle, yet nothing has parsed it
    await page.clock.runFor(PAST_IDLE_MS);
    expect(await parsesOf(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
    expect(await parsesOf(page)).toEqual(['start']);
    expect(shards(asked)).toEqual([cal.shardUrl]);
    expect(errors).toEqual([]);
  });

  test('with Save-Data on, NoToday loads no deck until Play another ten is pressed', async ({ page }) => {
    const errors = trackErrors(page);
    const asked = await serveSeason(page, cal);

    await saveData(page);
    await watchLoads(page);
    await page.goto(`./?date=${cal.unavailableDate}`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
    // the page logs each fetch as it's made, so a deck loading at once would be on the log by now
    expect((await loadsOf(page)).filter((load) => load.path.startsWith('shards/'))).toEqual([]);
    await page.locator('#btnPlay').click();
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
    expect(shards(asked)).toEqual([cal.shardUrl]);
    expect(errors).toEqual([]);
  });
});
