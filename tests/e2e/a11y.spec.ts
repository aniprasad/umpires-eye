// Keyboard and screen-reader access (the M1 review's N7): what Tab reaches in each phase, that each control it reaches
// has a name, and where focus goes when a round starts. Focus in Failed and Broken is states.spec.ts's (§5.1).
import { expect, test, type Page } from '@playwright/test';
import { activeId, callPitch, openPaused, stepClockUntil, trackErrors, waitReady } from './helpers';
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

/** The parts of the game that aren't inert, by id, or by class where they have none. */
const exposed = (page: Page): Promise<string[]> =>
  page.locator('#app').evaluate((app) => [...app.children].filter((el) => !(el as HTMLElement).inert).map((el) => el.id || el.className));

test("the start screen: Tab reaches Play, and not Ball or Strike, which show behind the panel", async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('./?pool=ws');
  await waitReady(page);
  await expect(page.locator('#btnBall')).toBeVisible();
  await expect(page.locator('#btnStrike')).toBeVisible();
  expect(await tabOrder(page)).toEqual(['btnPlay']);
  // A screen reader starts on the panel too: the rest of the game is inert behind it. Browsers leave inert content out of
  // the accessibility tree, though Playwright's aria snapshot doesn't, so the test reads the attribute.
  expect(await exposed(page)).toEqual(['start', 'live']);
  expect(errors).toEqual([]);
});

test("the card: the scene behind it is inert, so only the card is heard and reached", async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('./?pool=ws&state=card&correct=8');
  await waitReady(page);
  expect(await exposed(page)).toEqual(['cards', 'live']);
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

test("during a pitch, the indicator reads the count, not its wheels' digits", async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('./?pool=ws&state=pitch&i=3&t=0.2');
  await waitReady(page);
  const tree = await page.locator('#indicator').ariaSnapshot();

  expect(tree).toMatch(/Count \d+ balls?, \d+ strikes?, \d+ outs?/);
  expect(tree).not.toMatch(/\b0\b.*\b1\b.*\b2\b.*\b3\b|Pitch/);
  expect(errors).toEqual([]);
});

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

test('after Watch it slow, Space goes on to the next pitch, as its key cap says', async ({ page }) => {
  const errors = trackErrors(page);
  const app = page.locator('#app');

  await openPaused(page, './?pool=ws');
  await page.keyboard.press('Enter');
  await callPitch(page, 'S');
  await page.keyboard.press('r');
  await expect(app).toHaveAttribute('data-phase', 'replay');
  await stepClockUntil(page, 1000, async () => (await app.getAttribute('data-phase')) === 'reveal', "The replay's end");
  await expect.poll(() => activeId(page)).toBe('btnNext');
  await page.keyboard.press('Space');
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await expect(page.locator('#indPitch')).toHaveText('2/10');
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
