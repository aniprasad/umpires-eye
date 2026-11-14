import { expect, test } from '@playwright/test';
import type { Area, Box } from './helpers';
import {
  attachShot,
  boxOf,
  callPitch,
  expectApart,
  expectInside,
  horizontalOverflow,
  noteCanvasFilter,
  openPaused,
  sceneColours,
  slugOf,
  todaysTen,
  trackErrors,
  viewportOf,
  waitReady,
} from './helpers';
import { dateLabel } from '../../src/data/dates';
import { SEASON_LABEL } from '../../src/data/season2026';
import { setLine } from '../../src/math/words';
import { seasonMini } from '../fixtures/season-mini';
import { DATA, errorsBut, hold, mini, saveData, serveSeason } from './season-data';

const MONTH = 'daily/2026-11.json';
const CLOSE = Math.round((mini.files.get('stats.json') as { umpVsAbs: { close: { pct: number } } }).umpVsAbs.close.pct * 10) / 10;

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

  await openPaused(page, './?pool=ws');
  await noteCanvasFilter(page, testInfo);
  await page.locator('#btnPlay').tap();

  for (let n = 1; n <= ten.length; n++) {
    await test.step(`pitch ${n}`, async () => {
      await expect(app).toHaveAttribute('data-phase', 'pitch');
      await expect(page.locator('#indPitch')).toHaveText(`${n}/${ten.length}`);
      await callPitch(page, page.locator('#btnStrike'), { tap: true });
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

    await page.goto(`./?pool=ws&${state}`);
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

// The M3 review's finding 1: the season sets a score against the umps' close calls, which takes more words.
test("the season's close-call figure fits a phone: Play in view, the chip says close calls, and the card's row keeps one line", async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const label = page.locator('#ubFigLabel');

  await serveSeason(page);
  await page.goto(`./?date=${mini.date}`);
  await waitReady(page);
  await expect(page.locator('#hook')).toHaveText(/, but only [\d.]+% of the close ones\. Can you\?$/);
  await attachShot(page, testInfo, 'season-start');
  await expect(page.locator('#btnPlay')).toBeInViewport();
  await page.goto(`./?date=${mini.date}&state=pitch&i=3&t=0.2`);
  await waitReady(page);
  await expect(page.locator('#scSub .sc-short .sc-ph')).toHaveText(['Close calls', `MLB ${CLOSE}%`]);
  await attachShot(page, testInfo, 'season-chip');

  const area = viewportOf(page);
  const chip = await boxOf(page, '#scoreChip');

  expectInside(chip, area, '#scoreChip');
  expectApart(await boxOf(page, '#matchup'), chip, '#matchup and #scoreChip');
  await page.goto(`./?date=${mini.date}&state=card&correct=7`);
  await waitReady(page);
  await expect(label).toHaveText('MLB umps on close calls');
  await attachShot(page, testInfo, 'season-card');
  // its height over its height on one unbroken line
  expect(await label.evaluate((el: HTMLElement) => {
    const height = el.offsetHeight;

    el.style.whiteSpace = 'nowrap';

    return Math.round(height / el.offsetHeight);
  })).toBe(1);
  expect(await horizontalOverflow(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("the season card's set line stays on two lines, for any date and for Another ten", async ({ page }) => {
  const errors = trackErrors(page);
  const set = page.locator('#ubSet');
  // each month's longest date, as the card writes it, and Another ten's line
  const lines = [
    ...Array.from({ length: 12 }, (_, m) => setLine(SEASON_LABEL, "Today's Ten", dateLabel(`2026-${String(m + 1).padStart(2, '0')}-28`))),
    setLine(SEASON_LABEL, 'Another ten'),
  ];

  await serveSeason(page);
  await page.goto(`./?date=${mini.date}&state=card&correct=7`);
  await waitReady(page);
  await expect(set).toHaveText('2026 season set · November 14, 2026');
  const counts = await set.evaluate((el: HTMLElement, all) => {
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    const count = (): number => Math.round(el.offsetHeight / lineHeight);
    const shown = count();

    return [shown, ...all.map((line) => {
      el.textContent = line;

      return count();
    })];
  }, lines);

  expect(counts).toEqual(Array.from({ length: lines.length + 1 }, () => 2));
  expect(errors).toEqual([]);
});

test("the season's start screen says it's loading, then that it didn't load, and a tap on Try again loads it", async ({ page }) => {
  const { errors, allowed } = errorsBut(page, MONTH);
  const play = page.locator('#btnPlay');
  let missing = true;

  await serveSeason(page);
  await page.route((url) => url.pathname.endsWith(DATA + MONTH), (route) => (missing ? route.fulfill({ status: 404, body: 'Not Found' }) : route.fallback()));
  const release = await hold(page, MONTH);

  await page.goto(`./?date=${mini.date}`);
  await expect(play).toHaveText("Loading today's pitches");
  await expect(play).toBeDisabled();
  await expect(page.locator('#start')).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(page.locator('html')).toHaveAttribute('data-error', 'missing');
  await expect(play).toHaveText('Try again');
  expectInside(await boxOf(page, '#btnPlay'), viewportOf(page), 'Try again');
  missing = false;
  await play.tap();
  await waitReady(page);
  await expect(play).toHaveText('Play ball');
  expect(allowed).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("NoToday's tap says Dealing… while the shard loads, then the round starts", async ({ page }) => {
  const errors = trackErrors(page);
  const cal = seasonMini({ calendar: true });
  const play = page.locator('#btnPlay');

  // under Save-Data, nothing loads the shard before the tap
  await saveData(page);
  await serveSeason(page, cal);
  const release = await hold(page, cal.shardUrl.split('?')[0] ?? '');

  await page.goto(`./?date=${cal.unavailableDate}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'none');
  await play.tap();
  await expect(play).toHaveText('Dealing…');
  await expect(play).toBeDisabled();
  release();
  await expect(page.locator('#app')).toHaveAttribute('data-phase', 'pitch');
  expect(errors).toEqual([]);
});