import { expect, test } from '@playwright/test';
import type { CallKey } from './helpers';
import { activeId, callOf, callUntilAccepted, phaseMarks, recordPhases, secondsBetween, todaysTen, trackErrors, waitReady } from './helpers';

// Every binding gets used, and the strikes and balls are mixed so the expected score comes from the data.
const KEYS: readonly CallKey[] = ['S', 'B', 'ArrowRight', 'ArrowLeft', 's', 'b', 'S', 'ArrowLeft', 'ArrowRight', 'B'];
const WORD = { strike: 'Strike', ball: 'Ball' } as const;
const COPY_DONE = /^(Copied ✓|Copy failed: select the text)$/;

test('a keyboard round of ten ends on the umpire card', async ({ page }) => {
  test.setTimeout(180_000);

  const errors = trackErrors(page);
  const app = page.locator('#app');
  const ten = todaysTen();
  const expected = ten.filter((pitch, k) => callOf(KEYS[k]) === pitch.absTruth).length;
  const umpRight = ten.filter((pitch) => pitch.umpCorrect).length;

  expect(ten).toHaveLength(KEYS.length);
  await page.goto('./');
  await waitReady(page);
  await expect(page.locator('#btnPlay')).toBeEnabled();
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  await expect.poll(() => activeId(page)).toBe('btnPlay');
  await page.keyboard.press('Enter');

  for (const [k, key] of KEYS.entries()) {
    const n = k + 1;

    await test.step(`pitch ${n}: ${key}`, async () => {
      await expect(app).toHaveAttribute('data-phase', 'pitch');
      await expect(page.locator('#indPitch')).toHaveText(`${n}/10`);
      await callUntilAccepted(page, key);
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

test('an early press is ignored, and no call by the end of the window counts as a miss', async ({ page }) => {
  const errors = trackErrors(page);
  const app = page.locator('#app');

  await page.goto('./');
  await waitReady(page);
  await recordPhases(page);
  await page.keyboard.press('Enter');
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await page.keyboard.press('S');
  await expect(page.locator('#toast')).toHaveClass(/\bon\b/);
  await expect(page.locator('#toast')).toHaveText('Wait for the pitch');
  await expect(page.locator('#btnStrike')).not.toHaveClass(/\bis-called\b/);
  await expect(app).toHaveAttribute('data-phase', 'reveal', { timeout: 8_000 });
  await expect(page.locator('#vLine')).toHaveText(/^\s*You No call/);
  await expect(page.locator('#vCtx')).toContainText('Time ran out, which counts as a miss');

  // Release comes 2.4 s after Play, the ball takes about 0.4 s, and the window stays open 1.5 s past the catch.
  const waited = secondsBetween(await phaseMarks(page), 'pitch', 'reveal');

  expect(waited).toBeGreaterThan(3.9);
  expect(waited).toBeLessThan(6.5);
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the slow replay plays once and hands the reveal back', async ({ page }) => {
  const errors = trackErrors(page);
  const app = page.locator('#app');
  const replay = page.locator('#btnReplay');

  await page.goto('./?state=reveal&i=4&call=strike');
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

  await page.goto('./?state=card&correct=7');
  await waitReady(page);
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
  await callUntilAccepted(page, 'S');
  await expect(app).toHaveAttribute('data-phase', 'reveal');
  await expect(page.locator('#vLine')).toHaveText(/^\s*You Strike/);
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});
