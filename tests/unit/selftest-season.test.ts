import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Net } from '../../src/data/fetch';
import { seasonSource } from '../../src/data/season2026';
import { prep, type PreparedPitch } from '../../src/math/kinematics';
import { createLens } from '../../src/math/lens';
import { runSelfTest, SEASON_CHECKS, seasonSelfTestContext } from '../../src/selftest/checks';

// The shipped dataset, read through the season source as the page reads it, so the adapter's pitches are the ones checked.
const ROOT = new URL('../../public/data/season-2026/', import.meta.url);
const net: Net = {
  onLine: () => true,
  fetch: async (url) => new Response(readFileSync(new URL(url.split('?')[0] ?? url, ROOT)), { headers: { 'content-type': 'application/json' } }),
};
const source = seasonSource({ root: '', net });
const lens = createLens(source.lensPoints);
const NOVEMBER = Array.from({ length: 30 }, (_, d) => `2026-11-${String(d + 1).padStart(2, '0')}`);

describe("the season's self-test, over November's shipped Tens", () => {
  it('passes every check on every date', async () => {
    const failed: string[] = [];
    let checked = 0;

    for (const dateKey of NOVEMBER) {
      const today = await source.today(dateKey);

      if (today.kind !== 'ten') continue;
      checked++;
      const { failures } = runSelfTest(seasonSelfTestContext(today.pitches.map(prep), lens), SEASON_CHECKS);

      failed.push(...failures.map((f) => `${dateKey}: ${f}`));
    }
    expect(checked).toBe(NOVEMBER.length);
    expect(failed).toEqual([]);
  });

  it("fails a Ten that breaks the dealer's rules or the schedule's", async () => {
    const today = await source.today('2026-11-14');
    const rules = SEASON_CHECKS.find((c) => c.id === 'rules');

    if (today.kind !== 'ten' || !rules) throw new Error('November 14 has no ten, or the report no rules check');
    const [first, ...nine] = today.pitches.map(prep);

    if (!first) throw new Error('an empty ten');
    const failuresOf = (ten: PreparedPitch[]): string[] => rules.run(seasonSelfTestContext(ten, lens)).failures;

    // the calibrator played last: no easy call first
    expect(failuresOf([...nine, first])).toContain('today rules: no calibrator first');
    // every pitch from one game
    expect(failuresOf([first, ...nine.map((p) => ({ ...p, gamePk: first.gamePk }))])).toContain('today rules: one pitch per game: two come from one game');
  });
});
