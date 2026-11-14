// The season's start screen while Today's Ten loads, and when it can't (docs/M2-DESIGN.md §5.1), and Another ten's button
// while its deck loads (§5.2). The World Series keeps M1's, which failures.spec.ts covers.
import { expect, test } from '@playwright/test';
import { seasonMini } from '../fixtures/season-mini';
import { trackErrors, waitReady } from './helpers';
import { DATA, errorsBut, hold, mini, saveData, serveSeason, shards } from './season-data';

const MONTH = 'daily/2026-11.json';
const SHARD = mini.shardUrl.split('?')[0] ?? '';

// Nothing here depends on the pixel density, and WebKit repaints a new stance much faster at 1x.
test.use({ deviceScaleFactor: 1 });

test("while the month file is slow, Play says it's loading, the panel is busy, and after 6 s a line says why", async ({ page }) => {
  const errors = trackErrors(page);
  const play = page.locator('#btnPlay');
  const start = page.locator('#start');

  await serveSeason(page);
  const release = await hold(page, MONTH);

  await page.clock.install();
  await page.goto(`./?date=${mini.date}`);
  await expect(play).toHaveText("Loading today's pitches");
  await expect(play).toBeDisabled();
  await expect(start).toHaveAttribute('aria-busy', 'true');
  // the HUD's placeholders aren't real, so they stay out of sight
  await expect(page.locator('#matchup')).toBeHidden();
  await expect(page.locator('#indicator')).toBeHidden();
  await expect(page.locator('#slowHint')).toBeHidden();
  await page.clock.runFor(6_000);
  await expect(page.locator('#slowHint')).toBeVisible();
  await expect(page.locator('#slowHint')).toHaveText('Still loading. A slow connection can take a while.');
  release();
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(play).toHaveText('Play ball');
  await expect(start).not.toHaveAttribute('aria-busy');
  await expect(page.locator('#slowHint')).toBeHidden();
  await expect(page.locator('#live')).toHaveText("Today's Ten is ready.");
  await expect(page.locator('#matchup')).toBeVisible();
  await expect(page.locator('#indicator')).toBeVisible();
  expect(errors).toEqual([]);
});

// The M3 review's finding 6: the stats failed with the first load, and Try again brought the pitches back but never the
// ump figure.
test('Try again brings back the ump figure too, when it failed along with the pitches', async ({ page }) => {
  const { errors, allowed } = errorsBut(page, MONTH, 'stats.json');
  const play = page.locator('#btnPlay');
  let missing = true;

  await serveSeason(page);
  for (const file of [MONTH, 'stats.json']) {
    await page.route((url) => url.pathname.endsWith(DATA + file), (route) => (missing ? route.fulfill({ status: 404, body: 'Not Found' }) : route.fallback()));
  }
  await page.goto(`./?date=${mini.date}`);
  await expect(play).toHaveText('Try again');
  await expect(page.locator('#hook')).toHaveText('Can you call balls and strikes like an MLB umpire?');
  // the stats' 404 too, so their failed load has been dropped before the player tries again
  await expect.poll(() => allowed.length).toBeGreaterThanOrEqual(2);
  missing = false;
  await play.click();
  await waitReady(page);
  await expect(page.locator('#hook')).toHaveText(/, but only [\d.]+% of the close ones\. Can you\?$/);
  await expect(page.locator('#scSub .sc-long')).toHaveText(/^MLB umps [\d.]+% on close calls$/);
  expect(allowed.length).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('two failed tries, then one that works: the page gets there without the player', async ({ page }) => {
  const { errors, allowed } = errorsBut(page, MONTH);
  let tries = 0;

  await serveSeason(page);
  await page.route((url) => url.pathname.endsWith(DATA + MONTH), (route) => (++tries <= 2 ? route.fulfill({ status: 503, body: 'Busy' }) : route.fallback()));
  await page.goto(`./?date=${mini.date}`);
  await waitReady(page);
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  expect(tries).toBe(3);
  expect(allowed).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('a month file missing inside the schedule: Failed, with Try again and no other ten, then Try again loads it', async ({ page }) => {
  const { errors, allowed } = errorsBut(page, MONTH);
  const play = page.locator('#btnPlay');
  let missing = true;
  const asked = await serveSeason(page);

  await page.route((url) => url.pathname.endsWith(DATA + MONTH), (route) => (missing ? route.fulfill({ status: 404, body: 'Not Found' }) : route.fallback()));
  await page.goto(`./?date=${mini.date}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'error');
  await expect(page.locator('html')).toHaveAttribute('data-error', 'missing');
  await expect(page.locator('#startLede')).toHaveText("Today's pitches didn't load. Check your connection and try again.");
  await expect(play).toHaveText('Try again');
  await expect(play).toBeEnabled();
  await expect(play).toBeFocused();
  await expect(page.locator('#live')).toHaveText("Today's pitches didn't load. Check your connection and try again.");
  await expect(page.locator('#start')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('#err')).toBeHidden();
  await expect(page.locator('#matchup')).toBeHidden();
  await expect(page.locator('#indicator')).toBeHidden();
  expect(shards(asked)).toEqual([]);
  missing = false;
  const release = await hold(page, MONTH);

  await page.keyboard.press('Enter');
  // loading again, in Loading's words rather than Failed's
  await expect(page.locator('#startLede')).toHaveText("Today's Ten: real pitches from the 2026 season, at real speed, from the plate umpire's eye.");
  await expect(play).toHaveText("Loading today's pitches");
  release();
  await waitReady(page);
  await expect(play).toHaveText('Play ball');
  await expect(page.locator('#app')).toHaveAttribute('data-ten', mini.ten.map((pitch) => pitch.id).join(' '));
  await expect(page.locator('html')).not.toHaveAttribute('data-error');
  expect(allowed).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('offline at the start: the offline words, and coming back online loads the pitches', async ({ page }) => {
  const errors = trackErrors(page);

  await page.addInitScript(() => {
    let online = false;

    Object.defineProperty(navigator, 'onLine', { get: () => online, configurable: true });
    Object.assign(window, {
      ueOnline: () => {
        online = true;
        window.dispatchEvent(new Event('online'));
      },
    });
  });
  await serveSeason(page);
  await page.goto(`./?date=${mini.date}`);
  await expect(page.locator('html')).toHaveAttribute('data-error', 'offline');
  await expect(page.locator('#startLede')).toHaveText("You're offline. Connect and try again.");
  await expect(page.locator('#btnPlay')).toHaveText('Try again');
  await page.evaluate(() => (window as unknown as { ueOnline: () => void }).ueOnline());
  await waitReady(page);
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  expect(errors).toEqual([]);
});

test('a manifest of the wrong version: Broken, with the detail in the error box, and Reload reloads', async ({ page }) => {
  const errors = trackErrors(page);
  const play = page.locator('#btnPlay');
  const manifest = mini.files.get('manifest.json') as Record<string, unknown>;

  await serveSeason(page);
  await page.route((url) => url.pathname.endsWith(`${DATA}manifest.json`), (route) => route.fulfill({ json: { ...manifest, version: 99 } }));
  await page.goto(`./?date=${mini.date}`);
  await expect(page.locator('html')).toHaveAttribute('data-error', 'data');
  await expect(page.locator('#startLede')).toHaveText('The pitch data is out of date or damaged. Reload the page.');
  await expect(play).toHaveText('Reload');
  await expect(play).toBeEnabled();
  await expect(play).toBeFocused();
  await expect(page.locator('#err')).toContainText('version 99');
  await Promise.all([page.waitForEvent('framenavigated'), play.click()]);
  await expect(page.locator('html')).toHaveAttribute('data-error', 'data');
  expect(errors).toEqual([]);
});

test("a month file from an older build: one manifest refetch, then the file for the manifest's build", async ({ page }) => {
  const errors = trackErrors(page);
  const month = mini.files.get(MONTH) as Record<string, unknown>;
  const asked = await serveSeason(page);

  // the stale copy a cache might hold, answered only where the address has no ?v=
  await page.route((url) => url.pathname.endsWith(DATA + MONTH) && !url.search, (route) => route.fulfill({ json: { ...month, build: '000000000000' } }));
  await page.goto(`./?date=${mini.date}`);
  await waitReady(page);
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  expect(asked.filter((path) => path === 'manifest.json')).toHaveLength(2);
  expect(asked).toContain(`${MONTH}?v=${mini.build}`);
  expect(errors).toEqual([]);
});

test.describe('Another ten', () => {
  // under Save-Data, nothing loads the shard before the press
  test.beforeEach(async ({ page }) => saveData(page));

  test('the card\'s button says Dealing… while the shard loads, then the round starts', async ({ page }) => {
    const errors = trackErrors(page);
    const again = page.locator('#btnAgain');

    await serveSeason(page);
    const release = await hold(page, SHARD);

    await page.goto(`./?date=${mini.date}&state=reveal&i=10`);
    await waitReady(page);
    await page.keyboard.press('Space');
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'card');
    await again.click();
    await expect(again).toHaveText('Dealing…');
    await expect(again).toBeDisabled();
    await expect(again).toHaveAttribute('aria-busy', 'true');
    // the card stays readable behind it
    await expect(page.locator('#cards')).toBeVisible();
    release();
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
    expect(errors).toEqual([]);
  });

  test("a shard that won't load: the button says so, and pressing it tries again", async ({ page }) => {
    const { errors, allowed } = errorsBut(page, SHARD);
    const again = page.locator('#btnAgain');
    let down = true;

    await serveSeason(page);
    await page.route((url) => url.pathname.endsWith(DATA + SHARD), (route) => (down ? route.fulfill({ status: 503, body: 'Busy' }) : route.fallback()));
    await page.goto(`./?date=${mini.date}&state=reveal&i=10`);
    await waitReady(page);
    await page.keyboard.press('Space');
    await again.click();
    await expect(again).toHaveText("Couldn't load more pitches. Try again");
    await expect(again).toBeEnabled();
    await expect(again).not.toHaveAttribute('aria-busy');
    await expect(page.locator('#err')).toBeHidden();
    down = false;
    await again.click();
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
    // the first try and its two retries
    expect(allowed).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  test("a damaged shard: the error box says what's wrong, and the button reloads the page instead of trying again", async ({ page }) => {
    const errors = trackErrors(page);
    const again = page.locator('#btnAgain');
    const shard = mini.files.get(SHARD) as Record<string, unknown>;

    await serveSeason(page);
    await page.route((url) => url.pathname.endsWith(DATA + SHARD), (route) => route.fulfill({ json: { ...shard, version: 99 } }));
    await page.goto(`./?date=${mini.date}&state=reveal&i=10`);
    await waitReady(page);
    await page.keyboard.press('Space');
    await again.click();
    await expect(again).toHaveText("Couldn't load more pitches. Reload the page");
    await expect(again).toBeEnabled();
    await expect(page.locator('#err')).toContainText("The pitches for Another ten didn't add up: the version is 99, not 1.");
    await Promise.all([page.waitForEvent('framenavigated', { timeout: 10_000 }), again.click()]);
    await waitReady(page);
    expect(errors).toEqual([]);
  });

  test("NoToday's button says Dealing… while the shard loads, then the round starts", async ({ page }) => {
    const errors = trackErrors(page);
    const cal = seasonMini({ calendar: true });
    const play = page.locator('#btnPlay');

    await serveSeason(page, cal);
    const release = await hold(page, SHARD);

    await page.goto(`./?date=${cal.unavailableDate}`);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
    await play.click();
    await expect(play).toHaveText('Dealing…');
    await expect(play).toBeDisabled();
    await expect(play).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
    expect(errors).toEqual([]);
  });
});
