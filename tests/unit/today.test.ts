import { afterEach, describe, expect, it } from 'vitest';
import { dateKeyOf } from '../../src/core/daily.ts';
import { dateLabel, nextDayStart } from '../../src/data/dates';
import type { TodayResult, UmpFigure } from '../../src/data/source';
import { latestToday } from '../../src/game/today';
import { prep } from '../../src/math/kinematics';
import { noTodayLede, seasonLede } from '../../src/math/deal';
import { judged } from '../../src/math/flow';
import { figureWords, resultText, setLine } from '../../src/math/words';
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
    const copied = resultText({ label: '2026 season', roundLabel: "Today's Ten", date: 'November 14, 2026', figure: null, set, results });

    expect(copied.split('\n')[0]).toBe("Umpire's Eye · 2026 season · Today's Ten · November 14, 2026");
    expect(setLine('2026 season', "Today's Ten", 'November 14, 2026')).toBe('2026 season set · November 14, 2026');
  });

  it('leave a round without a date as it was', () => {
    expect(resultText({ label: '2026 season', roundLabel: 'Another ten', figure: null, set, results }).split('\n')[0]).toBe("Umpire's Eye · 2026 season · Another ten");
    expect(setLine('2026 World Series', "Today's Ten", null)).toBe("2026 World Series set · Today's Ten");
  });
});

describe('the ump figure in words (§5.4)', () => {
  const set = [prep(synthPitch())];
  const results = [judged(set[0], 'strike')];
  const cited: UmpFigure = { pct: 94, label: 'MLB umps', definition: 'UmpScorecards via mlb.com', approx: true };
  const overallOnly: UmpFigure = { pct: 93.2, label: 'season overall', definition: 'agreement with our ABS reconstruction on 2026 called pitches', approx: false, season: 2026 };
  const measured: UmpFigure = { ...overallOnly, close: { pct: 68.3, withinIn: 1.5 } };
  const ump = `The real ump: ${set.filter((P) => P.umpCorrect).length}/1.`;
  const copied = (figure: UmpFigure | null): string | undefined => resultText({ label: 'x', roundLabel: 'y', figure, set, results }).split('\n')[1];

  it("reads as M1 wrote it for the World Series' cited figure", () => {
    expect(figureWords(cited)).toEqual({
      hook: 'MLB umpires get about 94% of calls right. Can you?',
      chip: { long: 'Close calls · MLB umps ≈ 94%', short: ['Close calls', 'MLB ≈ 94%'] },
      scored: { long: 'Close calls · MLB umps ≈ 94% overall', short: ['MLB ≈ 94%'] },
      verdict: 'MLB umps ≈ 94% overall',
      row: { label: 'MLB umps', value: '≈ 94%' },
      cite: 'MLB umps ≈ 94%: UmpScorecards via mlb.com.',
      copy: 'MLB umps ≈ 94%.',
    });
    expect(copied(cited)).toBe(`I called 1 of 1 right (100%). ${ump} MLB umps ≈ 94%.`);
  });

  it("sets a score against the season's close calls, and the hook gives both figures (the M3 review's finding 1)", () => {
    const band = "within 1.5 in of the zone's edge";

    expect(figureWords(measured)).toEqual({
      hook: 'MLB umpires got 93.2% of calls right in 2026, but only 68.3% of the close ones. Can you?',
      chip: { long: 'MLB umps 68.3% on close calls', short: ['Close calls', 'MLB 68.3%'] },
      scored: { long: 'MLB umps 68.3% on close calls', short: ['Close calls', 'MLB 68.3%'] },
      verdict: 'MLB umps 68.3% on close calls',
      row: { label: 'MLB umps on close calls', value: '68.3%' },
      cite: `MLB umps 93.2% season overall, and 68.3% on close calls, ${band}: agreement with our ABS reconstruction on 2026 called pitches.`,
      copy: `MLB umps 68.3% on close calls, ${band}, against our ABS reconstruction.`,
    });
    expect(copied(measured)).toBe(`I called 1 of 1 right (100%). ${ump} MLB umps 68.3% on close calls, ${band}, against our ABS reconstruction.`);
    // without its season, the hook claims no time at all, rather than one that may have passed
    expect(figureWords({ ...measured, season: undefined }).hook).toBe('MLB umpires got 93.2% of calls right, but only 68.3% of the close ones. Can you?');
  });

  it('keeps the overall words without the close calls, and never puts them beside "Close calls"', () => {
    const words = figureWords(overallOnly);

    expect(words).toEqual({
      hook: 'MLB umpires got 93.2% of calls right in 2026. Can you?',
      chip: { long: 'MLB umps 93.2% season overall', short: ['MLB 93.2%'] },
      scored: { long: 'MLB umps 93.2% season overall', short: ['MLB 93.2%'] },
      verdict: 'MLB umps 93.2% season overall',
      row: { label: 'MLB umps', value: '93.2%' },
      cite: 'MLB umps 93.2%, season overall: agreement with our ABS reconstruction on 2026 called pitches.',
      copy: 'MLB umps 93.2% against our ABS reconstruction, season overall.',
    });
    expect(JSON.stringify(words)).not.toMatch(/close/i);
  });

  it('leaves the figure out when there is none, and the hook asks without a number', () => {
    const words = figureWords(null);
    const bare = { long: 'Close calls', short: ['Close calls'] };

    expect(words).toEqual({ hook: 'Can you call balls and strikes like an MLB umpire?', chip: bare, scored: bare, verdict: null, row: null, cite: null, copy: null });
    expect(words.hook).not.toMatch(/\d/);
    expect(copied(null)).toBe(`I called 1 of 1 right (100%). ${ump}`);
  });
});
