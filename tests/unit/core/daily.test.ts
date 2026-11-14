import { afterEach, describe, expect, it } from 'vitest';
import { dateKeyOf, isDailyReserve, monthOf, type DailyDoc } from '../../../src/core/daily.ts';
import { decodeTables } from '../../../src/core/decode.ts';
import { DAILY_FORMAT, SHARD_FORMAT } from '../../../src/core/schema.ts';
import { asFile, pitchCells, shardDoc } from './fixtures.ts';

describe('the daily reserve', () => {
  it('rests on the ID alone', () => {
    // The first three are challenged pitches that can't be dealt, and fall outside the reserve; the last two are in it.
    const ids = ['822806-17-2', '823728-4-4', '824320-68-3', '849799-1-1', '849799-65-7'];

    expect(ids.map(isDailyReserve)).toEqual([false, false, false, true, true]);
  });

  it('holds back about a quarter of a large set', () => {
    const ids = Array.from({ length: 20_000 }, (_, i) => `${700_000 + (i % 2_400)}-${1 + Math.floor(i / 2_400)}-${1 + (i % 7)}`);
    const share = ids.filter(isDailyReserve).length / ids.length;

    expect(share).toBeGreaterThan(0.24);
    expect(share).toBeLessThan(0.26);
  });
});

describe('dates', () => {
  const tz = process.env.TZ;

  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  it('come from the local calendar, not UTC', () => {
    // 23:30 on 14 Nov in Los Angeles; UTC is already on the 15th.
    const instant = new Date(Date.UTC(2026, 10, 15, 7, 30));

    process.env.TZ = 'America/Los_Angeles';
    expect(dateKeyOf(instant)).toBe('2026-11-14');
    process.env.TZ = 'Asia/Tokyo';
    expect(dateKeyOf(instant)).toBe('2026-11-15');
  });

  it('read a new month file from the first of the month', () => {
    expect(dateKeyOf(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
    expect([new Date(2026, 10, 30, 23, 59), new Date(2026, 11, 1, 0, 0)].map((d) => monthOf(dateKeyOf(d)))).toEqual(['2026-11', '2026-12']);
  });
});

describe('a month file', () => {
  it("reads with the shard's decoder, under its own format", () => {
    const rows = [pitchCells({ atBat: 1 }), pitchCells({ atBat: 2 })];
    const doc: DailyDoc = {
      ...shardDoc(rows),
      format: DAILY_FORMAT,
      month: '2026-05',
      build: 'b1',
      days: { '2026-05-14': { ids: ['900001-1-1', '900001-2-1'], available: true } },
    };

    expect(decodeTables(asFile(doc), DAILY_FORMAT).pitches.map((p) => p.id)).toEqual(['900001-1-1', '900001-2-1']);
    expect(() => decodeTables(asFile(doc), SHARD_FORMAT)).toThrow(DAILY_FORMAT);
  });
});
