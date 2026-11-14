import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { WS_TODAY_IDS, type PoolFile } from '../../src/data/ws2026';

const POOL = '**/data/ws-2026/pool.json';
const RELOAD_LEDE = /Check your connection, then reload the page\.$/;
const NOTE_LEDE = /The note at the bottom of the screen says what went wrong\.$/;

const pool = JSON.parse(readFileSync(new URL('../../public/data/ws-2026/pool.json', import.meta.url), 'utf8')) as PoolFile;

/** Uncaught exceptions only: a failed request for the pool also logs a console error, and here that's expected. */
function pageErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));

  return errors;
}

async function expectNoRound(page: Page, cause: RegExp, lede: RegExp): Promise<void> {
  const err = page.locator('#err');
  const play = page.locator('#btnPlay');

  await expect(page.locator('html')).toHaveAttribute('data-ready', 'error');
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('role', 'alert');
  await expect(err).toContainText(cause);
  await expect(page.locator('#startLede')).toHaveText(lede);
  await expect(play).toBeDisabled();
  await expect(play).toHaveText("Couldn't load the pitches");
  await expect(play).toHaveCSS('cursor', 'not-allowed');

  await page.keyboard.press('Enter');
  await page.keyboard.press('s');
  await page.keyboard.press('S');
  await play.click({ force: true });
  // A round that did start would have left the boot phase by now.
  await page.waitForTimeout(300);
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'boot');
}

test('a pitch file the server can\'t find leaves Play disabled and says why', async ({ page }) => {
  const errors = pageErrors(page);

  await page.route(POOL, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }));
  await page.goto('./?pool=ws');
  await expectNoRound(page, /The pitch data didn't load: Could not load the pitch data \(404/, NOTE_LEDE);
  expect(errors).toEqual([]);
});

test("a pool without one of Today's Ten is refused, naming the pitch", async ({ page }) => {
  const errors = pageErrors(page);
  const missing = WS_TODAY_IDS[3];
  const body = JSON.stringify({ ...pool, pitches: pool.pitches.filter((p) => p.id !== missing) });

  await page.route(POOL, (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.goto('./?pool=ws');
  await expectNoRound(page, new RegExp(`Today's Ten pitches are missing from the pool: ${missing}`), NOTE_LEDE);
  expect(errors).toEqual([]);
});

test('a lost connection asks for a reload', async ({ page }) => {
  const errors = pageErrors(page);

  await page.route(POOL, (route) => route.abort('internetdisconnected'));
  await page.goto('./?pool=ws');
  await expectNoRound(page, /The pitch data didn't load: Could not reach the pitch data/, RELOAD_LEDE);
  expect(errors).toEqual([]);
});

test("the server answers a data file it doesn't have with a 404, as GitHub Pages does, not with the app's page", async ({ request }) => {
  const res = await request.get('data/ws-2026/no-such-file.json');

  expect(res.status()).toBe(404);
});

test("card art that won't load is reported, and the game still starts", async ({ page }) => {
  const errors = pageErrors(page);

  await page.route('**/card-art-*.webp', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }));
  await page.goto('./?pool=ws');
  await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
  await expect(page.locator('#err')).toBeVisible();
  await expect(page.locator('#err')).toContainText(/Could not load \S*card-art-\d+-\S*\.webp/);
  await expect(page.locator('#btnPlay')).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
  expect(errors).toEqual([]);
});

// The built app is one module; its errors reach index.html's listeners, which run first (the M1 review's N12).
test.describe('a failure while the modules load', () => {
  const ENTRY = /\/assets\/index-[\w-]+\.js$/;

  async function expectReload(page: Page, cause: RegExp): Promise<void> {
    const play = page.locator('#btnPlay');

    await expect(page.locator('html')).toHaveAttribute('data-ready', 'error');
    await expect(page.locator('html')).toHaveAttribute('data-error', 'app');
    await expect(page.locator('#err')).toContainText(cause);
    await expect(page.locator('#startLede')).toHaveText("The game didn't load. Reload the page.");
    await expect(play).toHaveText('Reload');
    await expect(play).toBeEnabled();
    await expect(play).toBeFocused();
    await Promise.all([page.waitForEvent('framenavigated', { timeout: 10_000 }), play.click()]);
    // the reloaded page fails the same way
    await expect(page.locator('#startLede')).toHaveText("The game didn't load. Reload the page.");
  }

  test('a module that throws as it loads: the error box says so, and Play becomes Reload', async ({ page }) => {
    const errors = pageErrors(page);

    await page.route(ENTRY, (route) => route.fulfill({ contentType: 'text/javascript', body: "throw new Error('A module threw as it loaded');" }));
    await page.goto('./?pool=ws');
    await expectReload(page, /Error: .*A module threw as it loaded/);
    expect(errors).toEqual(['A module threw as it loaded', 'A module threw as it loaded']);
  });

  test("the app's code that won't load: the error box names the file, and Play becomes Reload", async ({ page }) => {
    const errors = pageErrors(page);
    const failed: string[] = [];

    page.on('console', (m) => {
      if (m.type() === 'error') failed.push(m.location().url);
    });
    await page.route(ENTRY, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }));
    await page.goto('./?pool=ws');
    await expectReload(page, /Could not load \S*\/assets\/index-[\w-]+\.js/);
    // the entry module's 404, once per load
    expect(failed).toHaveLength(2);
    for (const url of failed) expect(url).toMatch(ENTRY);
    expect(errors).toEqual([]);
  });

  test('an error once the app runs is only reported: the error box says so, and Play still plays', async ({ page }) => {
    const errors = pageErrors(page);
    const play = page.locator('#btnPlay');

    await page.goto('./?pool=ws');
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('A later fault');
      });
    });
    await expect(page.locator('#err')).toContainText(/Error: .*A later fault/);
    await expect(page.locator('html')).toHaveAttribute('data-ready', '1');
    await expect(play).toHaveText('Play ball');
    await play.click();
    await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
    expect(errors).toEqual(['A later fault']);
  });
});
