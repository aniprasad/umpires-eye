import { afterEach, describe, expect, it } from 'vitest';
import { dateKeyOf } from '../../src/core/daily.ts';
import { dateLabel, nextDayStart } from '../../src/data/dates';
import type { TodayResult } from '../../src/data/source';
import { latestToday } from '../../src/game/today';
import { prep } from '../../src/math/kinematics';
import { noTodayLede, seasonLede } from '../../src/math/deal';
import { judged } from '../../src/math/flow';
import { resultText, setLine } from '../../src/math/words';
import { synthPitch } from './fixtures';

const HOUR = 3_600_000;

describe('the start of the next local date', () => {
  const tz = process.env.TZ;

  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  /** Hours from `now` to the next date's start, which is the next date, a moment before which is still `now`'s. */
  function hoursToNextDay(now: Date): number {
    const next = nextDayStart(now);

    expect(dateKeyOf(new Date(next.getTime() - 1))).toBe(dateKeyOf(now));
    expect(dateKeyOf(next)).not.toBe(dateKeyOf(now));

    return (next.getTime() - now.getTime()) / HOUR;
  }

  it('is the local midnight, wherever the device is', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(hoursToNextDay(new Date('2026-11-14T06:00:00Z'))).toBe(2);
    process.env.TZ = 'Asia/Tokyo';
    expect(hoursToNextDay(new Date('2026-11-14T06:00:00Z'))).toBe(9);
  });

  it('comes 25 hours after the midnight that starts the day the clocks go back, and 23 after the one they go forward', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(hoursToNextDay(new Date('2026-11-01T00:00:00-07:00'))).toBe(25);
    expect(hoursToNextDay(new Date('2026-11-01T23:30:00-08:00'))).toBe(0.5);
    expect(hoursToNextDay(new Date('2026-03-08T00:00:00-08:00'))).toBe(23);
  });

  it('is 01:00 where the clocks skip midnight, as in Santiago on 2026-09-06', () => {
    process.env.TZ = 'America/Santiago';
    const next = nextDayStart(new Date('2026-09-05T12:00:00-04:00'));

    expect(next.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect([dateKeyOf(next), next.getHours()]).toEqual(['2026-09-06', 1]);
  });
});

describe('loading the Ten for a date (§2.2)', () => {
  const ten = (dateKey: string): TodayResult => ({ kind: 'ten', dateKey, pitches: [] });

  /** A load per date, each finishing when the test says, and the signals they were given. */
  function held() {
    const finish = new Map<string, { ok: (r: TodayResult) => void; fail: (e: unknown) => void }>();
    const signals = new Map<string, AbortSignal>();
    const loads = latestToday((dateKey, signal) => {
      signals.set(dateKey, signal);

      return new Promise<TodayResult>((ok, fail) => finish.set(dateKey, { ok, fail }));
    });

    return { loads, finish: (dateKey: string) => finish.get(dateKey), signals };
  }

  it('gives the latest date asked for: an earlier load is aborted, and dropped even if it finishes later', async () => {
    const { loads, finish, signals } = held();
    const first = loads.load('2026-11-13');
    const second = loads.load('2026-11-14');

    expect(signals.get('2026-11-13')?.aborted).toBe(true);
    expect(loads.busy()).toBe(true);
    finish('2026-11-14')?.ok(ten('2026-11-14'));
    finish('2026-11-13')?.ok(ten('2026-11-13'));
    expect(await second).toEqual(ten('2026-11-14'));
    expect(await first).toBeNull();
    expect(loads.busy()).toBe(false);
  });

  it("throws the latest load's failure, but drops an earlier one's", async () => {
    const { loads, finish } = held();
    const first = loads.load('2026-11-13');
    const second = loads.load('2026-11-14');

    finish('2026-11-13')?.fail(new Error('stale'));
    finish('2026-11-14')?.fail(new Error('the month file is missing'));
    expect(await first).toBeNull();
    await expect(second).rejects.toThrow('the month file is missing');
    expect(loads.busy()).toBe(false);
  });
});

describe('the words for a date', () => {
  const set = [prep(synthPitch())];
  const results = [judged(set[0], 'strike')];

  it('name the date on a season lede, and in NoToday', () => {
    expect(seasonLede([], '2026 season', dateLabel('2026-11-14'))).toMatch(/^Today's Ten for November 14, 2026: real pitches from the 2026 season, 0 of them close calls/);
    expect(noTodayLede(dateLabel('2027-01-01'), '2026 season')).toBe("There's no Today's Ten for January 1, 2027. Another ten deals fresh pitches from the 2026 season.");
  });

  it('put the date after the round in a copied result, and in place of the round on the card', () => {
    const copied = resultText({ label: '2026 season', roundLabel: "Today's Ten", date: 'November 14, 2026', set, results });

    expect(copied.split('\n')[0]).toBe("Umpire's Eye · 2026 season · Today's Ten · November 14, 2026");
    expect(setLine('2026 season', "Today's Ten", 'November 14, 2026')).toBe('2026 season set · November 14, 2026');
  });

  it('leave a round without a date as it was', () => {
    expect(resultText({ label: '2026 season', roundLabel: 'Another ten', set, results }).split('\n')[0]).toBe("Umpire's Eye · 2026 season · Another ten");
    expect(setLine('2026 World Series', "Today's Ten", null)).toBe("2026 World Series set · Today's Ten");
  });
});
