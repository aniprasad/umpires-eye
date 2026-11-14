// Keyboard and screen-reader access (the M1 review's N7): what Tab reaches in each phase, that each control it reaches
// has a name, and where focus goes when a round starts. Focus in Failed and Broken is states.spec.ts's (§5.1).
import { expect, test, type Page } from '@playwright/test';
import { activeId, callPitch, openPaused, trackErrors, waitReady } from './helpers';
import { hold, mini, serveSeason } from './season-data';

// Nothing here depends on the pixel density, and WebKit repaints a new stance much faster at 1x.
test.use({ deviceScaleFactor: 1 });

/** The controls Tab reaches from the top of the game, in order, each once. Each must have a name. */
async function tabOrder(page: Page): Promise<string[]> {
  const seen: string[] = [];

  await page.locator('#app').focus();
  // Past the last control, focus leaves the page for a press, then comes round to the first again.
  for (let k = 0; k < 6; k++) {
    await page.keyboard.press('Tab');
    const id = await activeId(page);

    if (id && !seen.includes(id)) seen.push(id);
  }
  for (const id of seen) await expect(page.locator(`#${id}`), `#${id} has a name`).toHaveAccessibleName(/\w/);

  return seen;
}

test("the start screen: Tab reaches Play, and not Ball or Strike, which show behind the panel", async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('./?pool=ws');
  await waitReady(page);
  await expect(page.locator('#btnBall')).toBeVisible();
  await expect(page.locator('#btnStrike')).toBeVisible();
  expect(await tabOrder(page)).toEqual(['btnPlay']);
  expect(errors).toEqual([]);
});

const ROUND = [
  { state: 'pitch&i=3&t=0.2', order: ['btnBall', 'btnStrike'] },
  { state: 'reveal&i=4&call=strike', order: ['btnReplay', 'btnNext'] },
  { state: 'card&correct=8', order: ['btnCopy', 'btnAgain'] },
];

for (const { state, order } of ROUND) {
  test(`?state=${state}: Tab reaches ${order.join(', then ')}`, async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto(`./?pool=ws&state=${state}`);
    await waitReady(page);
    expect(await tabOrder(page)).toEqual(order);
    expect(errors).toEqual([]);
  });
}

test("the season's start screen: nothing to Tab to while Today's Ten loads, then Play; in NoToday, Play", async ({ page }) => {
  const errors = trackErrors(page);

  await serveSeason(page);
  const release = await hold(page, 'daily/2026-11.json');

  await page.goto(`./?date=${mini.date}`);
  await expect(page.locator('#btnPlay')).toBeDisabled();
  expect(await tabOrder(page)).toEqual([]);
  release();
  await waitReady(page);
  expect(await tabOrder(page)).toEqual(['btnPlay']);
  await page.goto(`./?date=${mini.unavailableDate}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
  expect(await tabOrder(page)).toEqual(['btnPlay']);
  expect(errors).toEqual([]);
});

test('a round moves focus to the game when it starts, and to Next at the reveal', async ({ page }) => {
  const errors = trackErrors(page);

  await openPaused(page, './?pool=ws');
  await expect.poll(() => activeId(page)).toBe('btnPlay');
  await page.keyboard.press('Enter');
  // not the start panel's Play, which fades out and then hides
  await expect.poll(() => activeId(page)).toBe('app');
  await callPitch(page, 'S');
  await expect.poll(() => activeId(page)).toBe('btnNext');
  expect(errors).toEqual([]);
});

test("Another ten from the card moves focus to the game, as the card's buttons go", async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('./?pool=ws&state=card&correct=8');
  await waitReady(page);
  await page.locator('#btnAgain').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
  await expect.poll(() => activeId(page)).toBe('app');
  expect(errors).toEqual([]);
});
