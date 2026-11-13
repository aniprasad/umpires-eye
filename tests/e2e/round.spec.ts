import { expect, test } from '@playwright/test';
import type { CallKey } from './helpers';
import { activeId, callOf, callPitch, openPaused, phaseMarks, recordPhases, secondsBetween, stepClockUntil, todaysTen, trackErrors, waitReady } from './helpers';
import { mini, serveSeason } from './season-data';

// Every binding gets used, and the strikes and balls are mixed so the expected score comes from the data.
const KEYS: readonly CallKey[] = ['S', 'B', 'ArrowRight', 'ArrowLeft', 's', 'b', 'S', 'ArrowLeft', 'ArrowRight', 'B'];
const WORD = { strike: 'Strike', ball: 'Ball' } as const;
const COPY_DONE = /^(Copied ✓|Copy failed: select the text)$/;
// When an uncalled pitch's reveal may come, in seconds after Play.
const EARLIEST_REVEAL_S = 3.9;
const LATEST_REVEAL_S = 6.5;
const REVEAL_STEP_MS = 200;

test.describe(() => {
  // Each pitch repaints the static layers for a new stance: 2-5 s of WebKit's time at 2x, about 1 s at 1x. At 2x this
  // round took 90 s alone and up to 168 s of its 180 s on a loaded machine; at 1x, 24 s. Nothing it checks depends on the
  // pixel density, and the other tests here keep the project's 2x.
  test.use({ deviceScaleFactor: 1 });

  test('a keyboard round of ten ends on the umpire card', async ({ page }) => {
    test.setTimeout(180_000);

    const errors = trackErrors(page);
    const app = page.locator('#app');
    const ten = todaysTen();
    const expected = ten.filter((pitch, k) => callOf(KEYS[k]) === pitch.absTruth).length;
    const umpRight = ten.filter((pitch) => pitch.umpCorrect).length;

    expect(ten).toHaveLength(KEYS.length);
    await openPaused(page, './?pool=ws');
    await expect(page.locator('#btnPlay')).toBeEnabled();
    await expect(page.locator('#btnPlay')).toHaveText('Play ball');
    await expect.poll(() => activeId(page)).toBe('btnPlay');
    await page.keyboard.press('Enter');

    for (const [k, key] of KEYS.entries()) {
      const n = k + 1;

      await test.step(`pitch ${n}: ${key}`, async () => {
        await expect(app).toHaveAttribute('data-phase', 'pitch');
        await expect(page.locator('#indPitch')).toHaveText(`${n}/10`);
        await callPitch(page, key);
        await expect(app).toHaveAttribute('data-phase', 'reveal');
        await expect(page.locator('#vLine')).toHaveText(new RegExp(`^\\s*You ${WORD[callOf(key)]}`));
        await expect(page.locator('#nextLabel')).toHaveText(n < KEYS.length ? 'Next pitch' : 'See your card');
        await expect.poll(() => activeId(page)).toBe('btnNext');
        await page.keyboard.press('Space');
      });
    }

    await expect(app).toHaveAttribute('data-phase', 'card');
    await expect(page.locator('#cards')).toBeVisible();
    await expect(page.locator('#ubPitches')).toHaveText('10');
    await expect(page.locator('#ubCorrect')).toHaveText(String(expected));
    await expect(page.locator('#ucNum')).toHaveText(String(Math.round((100 * expected) / 10)));
    await expect(page.locator('#ubUmp')).toHaveText(`${umpRight}/10`);
    await expect(page.locator('#cardsSum')).toContainText(`You called ${expected} of 10 right`);
    await expect.poll(() => activeId(page)).toBe('btnCopy');
    await expect(page.locator('#err')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

test('an early press is ignored, and no call by the end of the window counts as a miss', async ({ page }) => {
  const errors = trackErrors(page);
  const app = page.locator('#app');

  // On the stopped clock the toast can't time out before it's seen, and no delay can move the end of the window.
  await openPaused(page, './?pool=ws');
  await recordPhases(page);
  await page.keyboard.press('Enter');
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await page.keyboard.press('S');
  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  await expect(page.locator('#toast')).toHaveText('Wait for the pitch');
  await expect(page.locator('#btnStrike')).not.toHaveClass(/\bis-called\b/);
  // Release comes 2.4 s after Play, the ball takes about 0.4 s, and the window stays open 1.5 s past the catch. One
  // jump lands a step short of the earliest it may close, where the pitch must still be live; steps find the reveal.
  await page.clock.fastForward(EARLIEST_REVEAL_S * 1000 - REVEAL_STEP_MS);
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await stepClockUntil(page, REVEAL_STEP_MS, async () => (await app.getAttribute('data-phase')) === 'reveal', 'The reveal');
  await expect(page.locator('#vLine')).toHaveText(/^\s*You No call/);
  await expect(page.locator('#vCtx')).toContainText('Time ran out, which counts as a miss');

  const waited = secondsBetween(await phaseMarks(page), 'pitch', 'reveal');

  expect(waited).toBeGreaterThan(EARLIEST_REVEAL_S);
  expect(waited).toBeLessThan(LATEST_REVEAL_S);
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the slow replay plays once and hands the reveal back', async ({ page }) => {
  const errors = trackErrors(page);
  const app = page.locator('#app');
  const replay = page.locator('#btnReplay');

  await page.goto('./?pool=ws&state=reveal&i=4&call=strike');
  await waitReady(page);
  await expect(app).toHaveAttribute('data-phase', 'reveal');
  await expect(replay).toBeEnabled();
  await recordPhases(page);
  await page.keyboard.press('R');
  await expect(app).toHaveAttribute('data-phase', 'replay');
  await expect(replay).toBeDisabled();
  await expect(app).toHaveAttribute('data-phase', 'reveal', { timeout: 8_000 });
  await expect(replay).toBeEnabled();
  await expect.poll(() => activeId(page)).toBe('btnReplay');

  // Quarter speed from 0.3 s before the release to just past the catch, then a 0.7 s hold: about 4 s for this pitch.
  const took = secondsBetween(await phaseMarks(page), 'replay', 'reveal');

  expect(took).toBeGreaterThan(3);
  expect(took).toBeLessThan(6);
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the card copies the result and deals another ten', async ({ page }) => {
  const errors = trackErrors(page);
  const app = page.locator('#app');
  const copy = page.locator('#btnCopy');

  await openPaused(page, './?pool=ws&state=card&correct=7');
  await expect(page.locator('#cards')).toBeVisible();
  await expect(copy).toHaveText('Copy result');
  await copy.click();
  // Headless clipboards may refuse the write; the app then says so and offers a prompt, which Playwright dismisses.
  await expect(copy).toHaveText(COPY_DONE);
  await page.locator('#btnAgain').click();
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await expect(page.locator('#cards')).toBeHidden();
  await expect(page.locator('#indPitch')).toHaveText('1/10');
  await expect(page.locator('#scMain')).toHaveText('Another ten');
  await callPitch(page, 'S');
  await expect(app).toHaveAttribute('data-phase', 'reveal');
  await expect(page.locator('#vLine')).toHaveText(/^\s*You Strike/);
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});

test('?pool=ws plays the World Series pool', async ({ page }) => {
  const errors = trackErrors(page);
  const data: string[] = [];

  page.on('request', (req) => {
    if (req.url().includes('/data/')) data.push(new URL(req.url()).pathname);
  });
  await page.goto('./?pool=ws');
  await waitReady(page);
  await expect(page.locator('#startLede')).toContainText('from Games 1, 2 and 5 of the 2026 World Series');
  await expect(page.locator('.footnote')).toContainText('ABS truth reconstructed from tracking data and matches all 29 real challenges in the Series.', { useInnerText: true });
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
  await expect(page.locator('#muGame')).toHaveText(/^2026 World Series · Game 5 · \d–\d count$/);
  expect(data.length).toBeGreaterThan(0);
  expect(data.filter((path) => !path.endsWith('/data/ws-2026/pool.json'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('the default is the 2026 season', async ({ page }) => {
  const errors = trackErrors(page);
  const asked = await serveSeason(page);
  const pool: string[] = [];

  page.on('request', (req) => {
    if (req.url().includes('/data/ws-2026/')) pool.push(req.url());
  });
  await page.goto(`./?date=${mini.date}`);
  await waitReady(page);
  await expect(page.locator('#startLede')).toHaveText(/^Today's Ten for November 14, 2026: real pitches from the 2026 season/);
  await expect(page.locator('.footnote')).toContainText('ABS truth reconstructed from tracking data. Players', { useInnerText: true });
  await page.keyboard.press('Enter');
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
  await expect(page.locator('#app')).toHaveAttribute('data-pitch', mini.ten[0].id);
  expect(asked).toEqual(expect.arrayContaining(['manifest.json', 'daily/2026-11.json']));
  expect(pool).toEqual([]);
  expect(errors).toEqual([]);
});
