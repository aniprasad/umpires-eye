import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { seasonMini } from '../fixtures/season-mini';
import type { CallKey } from './helpers';
import { activeId, callOf, callPitch, openPaused, trackErrors } from './helpers';

const mini = seasonMini();
const DATA = '/data/season-2026/';
// Every binding gets used, as in round.spec.ts.
const KEYS: readonly CallKey[] = ['S', 'B', 'ArrowRight', 'ArrowLeft', 's', 'b', 'S', 'ArrowLeft', 'ArrowRight', 'B'];
const WORD = { strike: 'Strike', ball: 'Ball' } as const;
const CALL = { S: 'strike', B: 'ball' } as const;

/** Serves the synthetic season in place of the real one, and records every data request, ?v= included. */
async function serveSeason(page: Page): Promise<string[]> {
  const asked: string[] = [];

  await page.route((url) => url.pathname.includes(DATA), (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(url.pathname.indexOf(DATA) + DATA.length);
    const body = mini.files.get(path);

    asked.push(path + url.search);

    return body === undefined ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }) : route.fulfill({ json: body });
  });

  return asked;
}

const shards = (asked: readonly string[]): string[] => asked.filter((path) => path.startsWith('shards/'));

test("?pool=season&date= plays that day's ten to the card by keyboard, then Another ten from a shard it loads only then", async ({ page }) => {
  test.setTimeout(180_000);

  const errors = trackErrors(page);
  const app = page.locator('#app');
  const asked = await serveSeason(page);
  const expected = mini.ten.filter((pitch, k) => callOf(KEYS[k]) === CALL[pitch.abs]).length;
  const umpRight = mini.ten.filter((pitch) => pitch.ump === pitch.abs).length;

  expect(mini.ten).toHaveLength(KEYS.length);
  await openPaused(page, `./?pool=season&date=${mini.date}`);
  await expect(page.locator('#btnPlay')).toHaveText('Play ball');
  await expect(page.locator('#startLede')).toHaveText(/^Today's Ten: real pitches from the 2026 season, \d+ of them close calls/);
  // no shard before Play (§4.2)
  expect(asked).toEqual(['manifest.json', 'daily/2026-11.json']);
  await page.keyboard.press('Enter');

  for (const [k, key] of KEYS.entries()) {
    const n = k + 1;
    const pitch = mini.ten[k];

    await test.step(`pitch ${n}: ${key}`, async () => {
      await expect(app).toHaveAttribute('data-phase', 'pitch');
      await expect(page.locator('#indPitch')).toHaveText(`${n}/10`);
      await expect(page.locator('#muGame')).toHaveText(`${pitch.label} · ${pitch.balls}–${pitch.strikes} count`);
      await callPitch(page, key);
      await expect(app).toHaveAttribute('data-phase', 'reveal');
      await expect(page.locator('#vLine')).toHaveText(new RegExp(`^\\s*You ${WORD[callOf(key)]}`));
      await expect.poll(() => activeId(page)).toBe('btnNext');
      await page.keyboard.press('Space');
    });
  }

  await expect(app).toHaveAttribute('data-phase', 'card');
  await expect(page.locator('#ubCorrect')).toHaveText(String(expected));
  await expect(page.locator('#ubUmp')).toHaveText(`${umpRight}/10`);
  await expect(page.locator('#ubSet')).toHaveText("2026 season set · Today's Ten");
  expect(shards(asked)).toEqual([]);

  await page.locator('#btnAgain').click();
  await expect(app).toHaveAttribute('data-phase', 'pitch');
  await expect(page.locator('#scMain')).toHaveText('Another ten');
  expect(shards(asked)).toEqual([mini.shardUrl]);
  await callPitch(page, 'S');
  await expect(app).toHaveAttribute('data-phase', 'reveal');
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});
