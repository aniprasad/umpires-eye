import { expect, test } from '@playwright/test';
import type { Area, Box } from './helpers';
import {
  attachShot,
  boxOf,
  callUntilAccepted,
  expectApart,
  expectInside,
  horizontalOverflow,
  noteCanvasFilter,
  sceneColours,
  slugOf,
  todaysTen,
  trackErrors,
  viewportOf,
  waitReady,
} from './helpers';

const LAYOUTS = [
  { state: 'state=pitch&i=3&t=0.2', left: '#btnBall', right: '#btnStrike' },
  { state: 'state=reveal&i=4&call=strike', left: '#btnReplay', right: '#btnNext' },
];

// A tenth of the screen leaves room for safe-area insets and still tells a corner from the middle.
function expectCorner(box: Box, area: Area, side: 'left' | 'right', label: string): void {
  const gap = side === 'left' ? box.x : area.width - (box.x + box.width);

  expect.soft(gap, `${label} hugs the ${side} edge`).toBeLessThan(area.width * 0.1);
  expect.soft(area.height - (box.y + box.height), `${label} sits at the bottom`).toBeLessThan(area.height * 0.1);
}

test('a round by touch ends on a card that scrolls to Play another ten', async ({ page }, testInfo) => {
  test.setTimeout(240_000);

  const errors = trackErrors(page);
  const app = page.locator('#app');
  const again = page.locator('#btnAgain');
  const ten = todaysTen();
  const strikes = ten.filter((pitch) => pitch.absTruth === 'strike').length;

  await page.goto('./');
  await waitReady(page);
  await noteCanvasFilter(page, testInfo);
  await page.locator('#btnPlay').tap();

  for (let n = 1; n <= ten.length; n++) {
    await test.step(`pitch ${n}`, async () => {
      await expect(app).toHaveAttribute('data-phase', 'pitch');
      await expect(page.locator('#indPitch')).toHaveText(`${n}/${ten.length}`);
      await callUntilAccepted(page, page.locator('#btnStrike'), { tap: true });
      await expect(app).toHaveAttribute('data-phase', 'reveal');
      await expect(page.locator('#vLine')).toHaveText(/^\s*You Strike/);
      await page.locator('#btnNext').tap();
    });
  }

  await expect(app).toHaveAttribute('data-phase', 'card');
  await expect(page.locator('#cards')).toBeVisible();
  await expect(page.locator('#ubCorrect')).toHaveText(String(strikes));
  await expect(page.locator('#ucNum')).toHaveText(String(Math.round((100 * strikes) / ten.length)));
  await again.scrollIntoViewIfNeeded();
  await expect(again).toBeVisible();
  await expect(again).toBeInViewport({ ratio: 0.9 });
  await attachShot(page, testInfo, 'card-at-play-another-ten');
  await again.tap();
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await expect(page.locator('#indPitch')).toHaveText(`1/${ten.length}`);
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const { state, left, right } of LAYOUTS) {
  test(`the controls and HUD fit the screen at ${state}`, async ({ page }, testInfo) => {
    const errors = trackErrors(page);
    const phase = new URLSearchParams(state).get('state');

    await page.goto(`./?${state}`);
    await waitReady(page);
    await noteCanvasFilter(page, testInfo);
    await attachShot(page, testInfo, slugOf(state));

    const area = viewportOf(page);
    const leftBox = await boxOf(page, left);
    const rightBox = await boxOf(page, right);
    const indicator = await boxOf(page, '#indicator');
    const controls: Array<[Box, string]> = [[leftBox, left], [rightBox, right], [indicator, '#indicator']];

    expectCorner(leftBox, area, 'left', left);
    expectCorner(rightBox, area, 'right', right);
    for (const [box, label] of controls) expectInside(box, area, label);
    expectApart(leftBox, rightBox, `${left} and ${right}`);
    expectApart(leftBox, indicator, `${left} and #indicator`);
    expectApart(rightBox, indicator, `${right} and #indicator`);

    if (phase === 'pitch') {
      const matchup = await boxOf(page, '#matchup');
      const chip = await boxOf(page, '#scoreChip');

      expectInside(matchup, area, '#matchup');
      expectInside(chip, area, '#scoreChip');
      expectApart(matchup, chip, '#matchup and #scoreChip');
    } else {
      const verdict = await boxOf(page, '#verdict');

      expectInside(verdict, area, '#verdict');
      for (const [box, label] of controls) expectApart(verdict, box, `#verdict and ${label}`);
    }

    expect(await horizontalOverflow(page)).toEqual([]);
    expect(await sceneColours(page), 'distinct colours sampled from #scene').toBeGreaterThan(1);
    await expect(page.locator('#err')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
