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
  await page.goto('./');
  await expectNoRound(page, /The pitch data didn't load: Could not load the pitch data \(404/, NOTE_LEDE);
  expect(errors).toEqual([]);
});

test("a pool without one of Today's Ten is refused, naming the pitch", async ({ page }) => {
  const errors = pageErrors(page);
  const missing = WS_TODAY_IDS[3];
  const body = JSON.stringify({ ...pool, pitches: pool.pitches.filter((p) => p.id !== missing) });

  await page.route(POOL, (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));
  await page.goto('./');
  await expectNoRound(page, new RegExp(`Today's Ten pitches are missing from the pool: ${missing}`), NOTE_LEDE);
  expect(errors).toEqual([]);
});

test('a lost connection asks for a reload', async ({ page }) => {
  const errors = pageErrors(page);

  await page.route(POOL, (route) => route.abort('internetdisconnected'));
  await page.goto('./');
  await expectNoRound(page, /The pitch data didn't load: Could not reach the pitch data/, RELOAD_LEDE);
  expect(errors).toEqual([]);
});
