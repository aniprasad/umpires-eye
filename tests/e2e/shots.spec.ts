import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CREDIT } from '../../src/core/rules.ts';
import { attachShot, boxOf, expectApart, expectInside, horizontalOverflow, sceneColours, slugOf, trackErrors, viewportOf, waitReady } from './helpers';
import { mini, serveSeason } from './season-data';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
];
const STATES = ['state=start', 'state=pitch&i=8&t=0.358', 'state=reveal&i=4&call=strike', 'state=reveal&i=1&call=ball', 'state=card&correct=7'];

async function expectVerdictClear(page: Page): Promise<void> {
  const area = viewportOf(page);
  const verdict = await boxOf(page, '#verdict');

  expectInside(verdict, area, '#verdict');
  for (const selector of ['#indicator', '#btnNext', '#btnReplay']) expectApart(verdict, await boxOf(page, selector), `#verdict and ${selector}`);
}

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(size, () => {
    test.use({ viewport });

    for (const state of STATES) {
      test(state, async ({ page }, testInfo) => {
        const errors = trackErrors(page);
        const params = new URLSearchParams(state);
        const phase = params.get('state');

        await page.goto(`./?pool=ws&${state}`);
        await waitReady(page);
        await attachShot(page, testInfo, `${size}-${slugOf(state)}`);
        await expect(page.locator('#err')).toBeHidden();
        expect(await horizontalOverflow(page)).toEqual([]);
        // The card covers the scene, so the canvas is only sampled where it shows.
        if (phase !== 'card') expect(await sceneColours(page), 'distinct colours sampled from #scene').toBeGreaterThan(1);

        if (phase === 'start') {
          await expect(page.locator('#btnPlay')).toHaveText('Play ball');
          await expect(page.locator('.footnote')).toContainText(CREDIT);
        }
        if (phase === 'pitch' || phase === 'reveal') await expect(page.locator('#indPitch')).toHaveText(`${params.get('i')}/10`);
        if (phase === 'reveal') {
          await expect(page.locator('#vLine')).toHaveText(params.get('call') === 'ball' ? /^\s*You Ball/ : /^\s*You Strike/);
          await expectVerdictClear(page);
        }
        if (phase === 'card') {
          await expect(page.locator('#cards')).toBeVisible();
          await expect(page.locator('#ucNum')).toHaveText(String(10 * Number(params.get('correct'))));
          await expect(page.locator('.cards-foot')).toContainText(CREDIT);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}

// The season's hook and its footnote both give a second figure, and the start screen must still fit them.
for (const viewport of [...VIEWPORTS, { width: 1280, height: 720 }]) {
  const size = `${viewport.width}x${viewport.height}`;

  test(`the season's start screen fits its two figures at ${size}`, async ({ page }, testInfo) => {
    const errors = trackErrors(page);

    await page.setViewportSize(viewport);
    await serveSeason(page);
    await page.goto(`./?date=${mini.date}`);
    await waitReady(page);
    await expect(page.locator('#hook')).toContainText('of the close ones');
    await expect(page.locator('#figCite')).toContainText('on close calls');
    await attachShot(page, testInfo, `season-start-${size}`);

    const area = viewportOf(page);
    const card = await boxOf(page, '.start-card');
    const foot = await boxOf(page, '.footnote');

    expectInside(card, area, '.start-card');
    expectInside(foot, area, '.footnote');
    expectApart(card, foot, '.start-card and .footnote');
    expect(await horizontalOverflow(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
