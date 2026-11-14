import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDailyReserve } from '../../src/core/daily.ts';
import { decodeTables } from '../../src/core/decode.ts';
import { DEAL_BOX, PLATE_FRONT_Y, RUBBER_Y } from '../../src/core/rules.ts';
import { SHARD_FORMAT } from '../../src/core/schema.ts';
import { boxLensPoints, rowReader } from '../../src/data/adapter';
import { isDateKey } from '../../src/data/dates';
import type { Net } from '../../src/data/fetch';
import { seasonSource } from '../../src/data/season2026';
import { LoadError } from '../../src/data/source';
import { openSource, sourceIdOf } from '../../src/data/sources';
import { playable } from '../../src/math/deal';
import { createLens } from '../../src/math/lens';
import { seasonMini } from '../fixtures/season-mini';
import { asFile, pitchCells, shardDoc, trajThrough, type PitchCells } from './core/fixtures';
import { synthPitch } from './fixtures';

const ROOT = 'data/season-2026/';
const mini = seasonMini();

/** Decodes a synthetic shard and reads its rows with the season adapter. */
function read(rows: readonly PitchCells[], over: Record<string, unknown> = {}) {
  const tables = decodeTables(asFile({ ...shardDoc(rows), ...over }), SHARD_FORMAT);
  const reader = rowReader(tables, 2026);

  return { tables, pitch: (i: number) => reader.pitch(tables.pitches[i], i) };
}

/**
 * Serves the season's files under ROOT, the query ignored, unless `answer` has something else to say for an address.
 * It records what each request asked for and how. `rand` picks the shards. A request waits for `hold`, as long as its
 * signal lets it. `onLine` is what the device says about its connection.
 */
function serve(
  files: ReadonlyMap<string, unknown> = mini.files,
  answer: (path: string) => Response | undefined = () => undefined,
  rand: () => number = () => 0,
  hold: (path: string) => Promise<void> = () => Promise.resolve(),
  onLine: () => boolean = () => true,
) {
  const asked: string[] = [];
  const net: Net = {
    onLine,
    fetch: async (url, init) => {
      const path = url.slice(ROOT.length);
      const body = files.get(path.split('?')[0]);
      const { signal } = init;

      asked.push(`${path} ${init.cache}`);
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason as unknown), { once: true });
        void hold(path).then(resolve);
      });

      return answer(path) ?? (body === undefined ? new Response('Not Found', { status: 404 }) : Response.json(body));
    },
  };

  return { source: seasonSource({ root: ROOT, net, rand }), asked };
}

/** A gate that holds requests until it opens. */
function gate(): { readonly held: () => Promise<void>; readonly open: () => void } {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { held: () => opened, open: () => open() };
}

/** The fixture's files with one replaced. */
const withFile = (path: string, body: unknown): Map<string, unknown> => new Map([...mini.files, [path, body]]);
const manifest = mini.files.get('manifest.json') as Record<string, unknown>;
const shardsAsked = (asked: readonly string[]): string[] => asked.filter((a) => a.startsWith('shards/'));

/** The fixture with its one shard served under three names, as shards 00, 01 and 02. */
function threeShards(): Map<string, unknown> {
  const [meta] = manifest.shards as Record<string, unknown>[];
  const shards = ['00', '01', '02'].map((n) => ({ ...meta, file: `shards/${n}.json` }));

  return new Map([...mini.files, ['manifest.json', { ...manifest, shards }], ['shards/01.json', mini.files.get('shards/00.json')], ['shards/02.json', mini.files.get('shards/00.json')]]);
}

describe('the season adapter (rows to pitches)', () => {
  it('reads the moment before the pitch: half, count, outs, score, runners, players and their sides', () => {
    const { pitch } = read([pitchCells({ top: 0, balls: 2, strikes: 1, outs: 2, awayScore: 3, homeScore: 4, bases: 5, bats: 'L', throws: 'L' })]);

    expect(pitch(0)).toMatchObject({
      id: '900001-1-1',
      half: 'bottom',
      countBefore: { balls: 2, strikes: 1 },
      outs: 2,
      score: { away: 3, home: 4 },
      runnersOn: ['1B', '3B'],
      batter: { id: 11, name: 'Sam Example', side: 'L', heightFt: 74 / 12 },
      pitcher: { id: 20, name: 'Pat Sample', hand: 'L' },
      pitchType: { code: 'FF', name: 'Four-Seam Fastball', family: 'fastball' },
    });
    expect(read([pitchCells({ bases: 7 })]).pitch(0).runnersOn).toEqual(['1B', '2B', '3B']);
  });

  it('turns S and B into calls, takes umpCorrect from the ump against ABS, and names the challenger and his role', () => {
    const missed = read([pitchCells({ ump: 'B', final: 'S', abs: 'S', marginIn: 0.4, challenge: [30, 'HOM', 'C', 1] })]).pitch(0);
    const roles = ['B', 'P', 'C'].map((role) => read([pitchCells({ challenge: [30, 'HOM', role, 0] })]).pitch(0).challenge?.byRole);

    expect(missed).toMatchObject({ absTruth: 'strike', umpCall: 'ball', finalCall: 'strike', umpCorrect: false, edgeMarginIn: 0.4 });
    expect(missed.challenge).toEqual({ by: 'Cal Catcher', byId: 30, byTeam: 'HOM', byRole: 'catcher', isOverturned: true });
    expect(roles).toEqual(['batter', 'pitcher', 'catcher']);
    expect(read([pitchCells({ ump: 'B', final: 'B', abs: 'B', marginIn: -2 })]).pitch(0)).toMatchObject({ absTruth: 'ball', umpCorrect: true, challenge: null });
  });

  it('works out the release, the mid-plate crossing and the flight from the path', () => {
    const p = read([pitchCells({ ...trajThrough(0.5, 2.6, 130), extension: 6.5 })]).pitch(0);

    expect(p.release.y).toBeCloseTo(RUBBER_Y - 6.5, 9);
    expect([p.mid.x, p.mid.z]).toEqual([0.5, 2.6]);
    expect(p.flightTime).toBeCloseTo((RUBBER_Y - 6.5 - PLATE_FRONT_Y) / 130, 9);
    expect(p).toMatchObject({ startSpeed: 95.1, extension: 6.5, zone: { top: 3.4, bottom: 1.6 } });
  });

  it('names a regular-season game by its date and a postseason game by its series and number', () => {
    const games = [
      [900001, '2026-05-01', '2026-05-01T17:05:00Z', 'R', 'AWY', 'HOM', null, null, 32],
      [900002, '2026-10-28', '2026-10-28T00:08:00Z', 'W', 'AWY', 'HOM', 'World Series', 5, null],
    ];
    const { pitch } = read([pitchCells(), pitchCells({ atBat: 2 }), pitchCells({ gamePk: 900002 })], { games });

    expect(pitch(0).game).toEqual({ gamePk: 900001, date: '2026-05-01', away: 'AWY', home: 'HOM', label: 'May 1, 2026', seriesGame: null, venue: 'A Park' });
    expect(pitch(1).game).toBe(pitch(0).game);
    expect(pitch(2).game).toMatchObject({ label: '2026 World Series · Game 5', seriesGame: 5, venue: null });
  });

  it("takes each pitch's own plate umpire, so a change in mid-game shows, and null where none is on record", () => {
    const { pitch } = read([pitchCells({ atBat: 1, umpire: 70 }), pitchCells({ atBat: 40, umpire: 71 }), pitchCells({ atBat: 41, umpire: null })]);

    expect([pitch(0).plateUmpire, pitch(1).plateUmpire, pitch(2).plateUmpire]).toEqual(['Plate Ump', 'Relief Ump', null]);
  });

  it("reads a null pitch type as an unknown pitch, and a missing height from the batter's zone", () => {
    const p = read([pitchCells({ type: null, batter: 20, zoneTop: 3.21 })]).pitch(0);

    expect(p.pitchType).toEqual({ code: '', name: 'Unknown pitch', family: 'other' });
    expect(p.batter.heightFt).toBeCloseTo(3.21 / 0.535, 12);
  });

  it('throws for a row that isn\'t dealable, or has no speed or extension, rather than reading a null as 0', () => {
    const { pitch } = read([pitchCells({ dealable: 0 }), pitchCells({ atBat: 2, mph: null }), pitchCells({ atBat: 3, extension: null })]);

    expect(() => pitch(0)).toThrow(new LoadError('data', "Pitch 900001-1-1 isn't dealable."));
    expect(() => pitch(1)).toThrow(new LoadError('data', 'Pitch 900001-2-1 has no speed.'));
    expect(() => pitch(2)).toThrow(new LoadError('data', 'Pitch 900001-3-1 has no extension.'));
  });
});

describe('which season rows reach a deck (§7.1)', () => {
  // A crossing inside the deal box with no extension, and a full row that takes 0.7 s to reach the plate. The data tools
  // store both as not dealable. Then a dealable row, and one held back for Today's Ten.
  const idleArm = pitchCells({ atBat: 1, extension: null, dealable: 0, ...trajThrough(0.2, 2.5) });
  const lob = pitchCells({ atBat: 2, dealable: 0, ...trajThrough(0, 2.5, (RUBBER_Y - 6.5 - PLATE_FRONT_Y) / 0.7) });
  const atBats = Array.from({ length: 40 }, (_, i) => i + 3);
  const kept = atBats.find((n) => !isDailyReserve(`900001-${n}-1`)) ?? 0;
  const held = atBats.find((n) => isDailyReserve(`900001-${n}-1`)) ?? 0;
  const shard = { ...shardDoc([idleArm, lob, pitchCells({ atBat: kept }), pitchCells({ atBat: held })]), build: mini.build };

  it('deals neither row stored as not dealable, though M1 would have dealt the one with no extension', async () => {
    const { source } = serve(withFile('shards/00.json', shard));
    const deck = await source.deck();

    expect(deck.pitches.map((p) => p.id)).toEqual([`900001-${kept}-1`]);
    expect(() => read([idleArm]).pitch(0)).toThrow("isn't dealable");
    // even marked dealable, its null extension is refused rather than read as 0
    expect(() => read([{ ...idleArm, dealable: 1 }]).pitch(0)).toThrow('has no extension');
    // M1's rule, given the null turned into 0, sees a crossing inside the box and a quick enough flight
    expect(playable(synthPitch({ traj: trajThrough(0.2, 2.5), mid: { x: 0.2, z: 2.5, t: 0 }, extension: Number(null) }))).toBe(true);
    expect(read([{ ...lob, dealable: 1 }]).pitch(0).flightTime).toBeCloseTo(0.7, 9);
  });
});

describe('the season source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serves a date's ten from its month file, in play order, and loads no shard for it", async () => {
    const { source, asked } = serve();
    const today = await source.today(mini.date);

    expect(today.kind).toBe('ten');
    expect(today.kind === 'ten' && today.pitches.map((p) => [p.id, p.order])).toEqual(mini.ten.map((p, i) => [p.id, i]));
    expect(today.kind === 'ten' && today.pitches.map((p) => p.game.label)).toEqual(mini.ten.map((p) => p.label));
    expect(asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache']);
  });

  it('has no ten past either end of the schedule, whatever its month file says, and none on an unavailable day', async () => {
    const { source, asked } = serve();

    expect(await source.today('2026-11-13')).toEqual({ kind: 'none', dateKey: '2026-11-13', reason: 'outside-horizon' });
    expect(await source.today('2026-11-16')).toEqual({ kind: 'none', dateKey: '2026-11-16', reason: 'outside-horizon' });
    // there's no December file, and past the schedule that's no error
    expect(await source.today('2026-12-01')).toEqual({ kind: 'none', dateKey: '2026-12-01', reason: 'outside-horizon' });
    // a date asked for once the manifest has arrived checks it for a new build (§2.2)
    expect(asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache', 'manifest.json no-cache', 'manifest.json no-cache', 'daily/2026-12.json no-cache']);
    expect(await source.today(mini.unavailableDate)).toEqual({ kind: 'none', dateKey: mini.unavailableDate, reason: 'unavailable' });
  });

  it("asks for the date's month file alongside the manifest, not after it (§4.1)", async () => {
    const { held, open } = gate();
    const { source, asked } = serve(mini.files, undefined, undefined, (path) => (path === 'manifest.json' ? held() : Promise.resolve()));
    const today = source.today(mini.date);

    await vi.waitFor(() => expect(asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache']));
    open();
    expect((await today).kind).toBe('ten');
    expect(asked).toHaveLength(2);
  });

  it('reads the month file the manifest lists, when it has another name', async () => {
    const daily = manifest.daily as { files: Record<string, unknown>[] };
    const renamed = { ...manifest, daily: { ...daily, files: daily.files.map((f) => ({ ...f, file: 'daily/november.json' })) } };
    const files = new Map([...withFile('manifest.json', renamed), ['daily/november.json', mini.files.get('daily/2026-11.json')]]);

    files.delete('daily/2026-11.json');
    const { source, asked } = serve(files);

    expect((await source.today(mini.date)).kind).toBe('ten');
    expect(asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache', 'daily/november.json no-cache']);
  });

  it('calls a month file missing inside the schedule missing, and a manifest without a schedule, or of another version, broken', async () => {
    const daily = manifest.daily as Record<string, unknown>;
    const december = { ...manifest, daily: { ...daily, last: '2026-12-31', files: [...(daily.files as unknown[]), { month: '2026-12', file: 'daily/2026-12.json' }] } };
    const failure = (files: Map<string, unknown>, dateKey: string) => serve(files).source.today(dateKey).catch((e: unknown) => e);

    expect(await failure(withFile('manifest.json', december), '2026-12-05')).toMatchObject({ kind: 'missing', message: 'Could not load the pitches for December 2026 (404).' });
    expect(await failure(withFile('manifest.json', { ...manifest, daily: undefined }), mini.date)).toMatchObject({ kind: 'data', message: expect.stringMatching(/no daily block/) });
    expect(await failure(withFile('manifest.json', { ...manifest, version: 2 }), mini.date)).toMatchObject({ kind: 'data', message: expect.stringMatching(/version 2, not/) });
  });

  it('recovers from a stale month file with one manifest refetch and the file again under ?v=, and calls a lasting mismatch broken', async () => {
    const month = mini.files.get('daily/2026-11.json');
    const stale = Response.json({ ...month, build: 'old000000000' });
    const race = serve(mini.files, (path) => (path === 'daily/2026-11.json' ? stale.clone() : undefined));
    const today = await race.source.today(mini.date);

    expect(today.kind).toBe('ten');
    expect(race.asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache', 'manifest.json reload', `daily/2026-11.json?v=${mini.build} no-cache`]);

    const lasting = serve(mini.files, (path) => (path.startsWith('daily/') ? stale.clone() : undefined));

    await expect(lasting.source.today(mini.date)).rejects.toMatchObject({ kind: 'data', message: expect.stringMatching(/from build old000000000, the manifest from build/) });
  });

  it('checks the manifest again for a later date, and a new build drops the old month files (§2.2)', async () => {
    const month = mini.files.get('daily/2026-11.json') as Record<string, unknown>;
    let build = '';
    const { source, asked } = serve(mini.files, (path) => {
      if (!build) return undefined;
      if (path === 'manifest.json') return Response.json({ ...manifest, build });

      return path === 'daily/2026-11.json' ? Response.json({ ...month, build }) : undefined;
    });

    expect((await source.today(mini.date)).kind).toBe('ten');
    // the same build: November's file serves the next date from memory
    expect(await source.today(mini.unavailableDate)).toMatchObject({ kind: 'none', reason: 'unavailable' });
    expect(asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache', 'manifest.json no-cache']);
    build = 'new000000000';
    expect((await source.today(mini.date)).kind).toBe('ten');
    expect(asked.slice(3)).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache']);
  });

  it("keeps the manifest it has when the check gets no answer, and stops at one it can't read", async () => {
    let answer: Response | undefined;
    const { source, asked } = serve(mini.files, (path) => (path === 'manifest.json' ? answer?.clone() : undefined));

    expect((await source.today(mini.date)).kind).toBe('ten');
    answer = new Response('Not Found', { status: 404 });
    expect((await source.today(mini.date)).kind).toBe('ten');
    expect(asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache', 'manifest.json no-cache']);
    answer = Response.json({ ...manifest, version: 2 });
    await expect(source.today(mini.date)).rejects.toMatchObject({ kind: 'data', message: expect.stringMatching(/version 2, not/) });
  });

  it('serves a later date from the month file it has when the check finds the device offline, or the network down', async () => {
    let online = true;
    let down = false;
    const { source, asked } = serve(mini.files, (path) => (down && path === 'manifest.json' ? new Response('Busy', { status: 503 }) : undefined), undefined, undefined, () => online);

    expect((await source.today(mini.date)).kind).toBe('ten');
    online = false;
    expect(await source.today(mini.unavailableDate)).toMatchObject({ kind: 'none', reason: 'unavailable' });
    expect(asked).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache']);
    online = true;
    down = true;
    vi.useFakeTimers();
    try {
      const later = source.today(mini.date);

      await vi.advanceTimersByTimeAsync(2500);
      expect((await later).kind).toBe('ten');
    } finally {
      vi.useRealTimers();
    }
    // the check and its two retries, and November from memory
    expect(asked.slice(2)).toEqual(['manifest.json no-cache', 'manifest.json no-cache', 'manifest.json no-cache']);
  });

  it("drops the month files when a shard's build check brings a new manifest, so a later date reads the new build's", async () => {
    const month = mini.files.get('daily/2026-11.json') as Record<string, unknown>;
    const shard = mini.files.get('shards/00.json') as Record<string, unknown>;
    let build = '';
    const { source, asked } = serve(mini.files, (path) => {
      if (!build) return undefined;
      if (path === 'manifest.json') return Response.json({ ...manifest, build });
      if (path.startsWith('shards/')) return Response.json({ ...shard, build });

      return path === 'daily/2026-11.json' ? Response.json({ ...month, build }) : undefined;
    });

    expect((await source.today(mini.date)).kind).toBe('ten');
    build = 'new000000000';
    // the shard is from the new build, so its check asks for the manifest again, past the cache, and takes it
    await source.deck();
    expect(asked.slice(2)).toEqual([`${mini.shardUrl} force-cache`, 'manifest.json reload']);
    expect((await source.today(mini.date)).kind).toBe('ten');
    // the later date's check finds that build, and November is read again under it
    expect(asked.slice(4)).toEqual(['manifest.json no-cache', 'daily/2026-11.json no-cache']);
  });

  it("deals Another ten from one shard, loaded on the first deck(): dealable rows only, none of Today's, in file order", async () => {
    const { source, asked } = serve();
    const deck = await source.deck();

    expect(asked).toEqual(['manifest.json no-cache', `${mini.shardUrl} force-cache`]);
    expect(deck.pitches.map((p) => p.id)).toEqual(mini.deckIds);
    expect(deck.pitches.every((p, i) => i === 0 || p.order > (deck.pitches[i - 1]?.order ?? Infinity))).toBe(true);
    expect(deck.pitches.some((p) => mini.ten.some((t) => t.id === p.id))).toBe(false);
    expect(await source.deck()).toBe(deck);
    expect(await deck.next()).toBeNull();
    expect(asked).toHaveLength(2);
  });

  it("tries the shard again on the next deck() when it didn't load", async () => {
    let refusals = 1;
    const { source, asked } = serve(mini.files, (path) => (path.startsWith('shards/') && refusals-- > 0 ? new Response('', { status: 404 }) : undefined));

    await expect(source.deck()).rejects.toMatchObject({ kind: 'missing' });
    expect((await source.deck()).pitches.length).toBe(mini.deckIds.length);
    expect(asked.filter((a) => a.startsWith('shards/'))).toHaveLength(2);
  });

  it('prefetch() loads the first shard as text, and deck() parses that text once, without asking for it again', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    const shardParses = (): number => parse.mock.calls.filter(([text]) => typeof text === 'string' && text.includes(SHARD_FORMAT)).length;
    const { source, asked } = serve();

    source.prefetch?.();
    await vi.waitFor(() => expect(shardsAsked(asked)).toEqual([`${mini.shardUrl} force-cache`]));
    expect(shardParses()).toBe(0);
    const deck = await source.deck();

    // a prefetch that parsed would have done so before deck() could
    expect(shardParses()).toBe(1);
    expect(deck.pitches.map((p) => p.id)).toEqual(mini.deckIds);
    expect(asked).toEqual(['manifest.json no-cache', `${mini.shardUrl} force-cache`]);
  });

  it('prefetch() never rejects: a shard that failed to load is asked for again by deck()', async () => {
    const unhandled: unknown[] = [];
    const note = (e: unknown): void => {
      unhandled.push(e);
    };
    let refusals = 1;
    const { source, asked } = serve(mini.files, (path) => (path.startsWith('shards/') && refusals-- > 0 ? new Response('', { status: 404 }) : undefined));

    process.on('unhandledRejection', note);
    try {
      source.prefetch?.();
      await vi.waitFor(() => expect(shardsAsked(asked)).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', note);
    }
    expect((await source.deck()).pitches).toHaveLength(mini.deckIds.length);
    expect(shardsAsked(asked)).toHaveLength(2);
  });

  it("takes each next deck from a shard the page hasn't used, picked at random, until none is left", async () => {
    const picks = [0.9, 0.5, 0];
    const { source, asked } = serve(threeShards(), undefined, () => picks.shift() ?? 0);
    const first = await source.deck();
    const second = await first.next();
    const third = await second?.next();

    expect(await third?.next()).toBeNull();
    expect(await first.next()).toBe(second);
    expect(shardsAsked(asked).map((a) => a.split('?')[0])).toEqual(['shards/02.json', 'shards/01.json', 'shards/00.json']);
  });

  it('tries the same shard again when a next deck failed to load', async () => {
    let refusals = 1;
    const { source, asked } = serve(threeShards(), (path) => (path.startsWith('shards/01.json') && refusals-- > 0 ? new Response('', { status: 404 }) : undefined));
    const first = await source.deck();

    await expect(first.next()).rejects.toMatchObject({ kind: 'missing' });
    expect((await first.next())?.pitches).toHaveLength(mini.deckIds.length);
    expect(shardsAsked(asked).map((a) => a.split('?')[0])).toEqual(['shards/00.json', 'shards/01.json', 'shards/01.json']);
  });

  it("lets a caller stop waiting for a load it shares: only that caller rejects, with its signal's reason", async () => {
    const { held, open } = gate();
    const { source, asked } = serve(mini.files, undefined, undefined, held);
    const stale = new AbortController();
    const reason = new Error('the date changed');
    const first = source.today(mini.date, stale.signal);
    const second = source.today(mini.date);

    stale.abort(reason);
    await expect(first).rejects.toBe(reason);
    open();
    expect((await second).kind).toBe('ten');
    expect([...asked].sort()).toEqual(['daily/2026-11.json no-cache', 'manifest.json no-cache']);
  });

  it('keeps a load whose only caller stopped waiting, for the next caller, without asking again', async () => {
    const { held, open } = gate();
    const { source, asked } = serve(mini.files, undefined, undefined, held);
    const gone = new AbortController();
    const first = source.deck(gone.signal);

    gone.abort(new Error('left the page'));
    await expect(first).rejects.toThrow('left the page');
    open();
    expect((await source.deck()).pitches.map((p) => p.id)).toEqual(mini.deckIds);
    expect(asked).toEqual(['manifest.json no-cache', `${mini.shardUrl} force-cache`]);
  });

  it('keeps a deck loading for the callers still waiting when the first one stops', async () => {
    const { held, open } = gate();
    const { source, asked } = serve(mini.files, undefined, undefined, held);
    const gone = new AbortController();
    const first = source.deck(gone.signal);
    const second = source.deck();

    gone.abort(new Error('left the page'));
    await expect(first).rejects.toThrow('left the page');
    open();
    const deck = await second;

    expect(deck.pitches.map((p) => p.id)).toEqual(mini.deckIds);
    expect(await source.deck()).toBe(deck);
    expect(asked).toEqual(['manifest.json no-cache', `${mini.shardUrl} force-cache`]);
  });

  it('gives the ump figure from the stats, to one decimal and labelled season overall, or null without them', async () => {
    const stats = mini.files.get('stats.json') as { umpVsAbs: { overall: { pct: number } } };

    expect(await serve().source.umpFigure()).toEqual({
      pct: Math.round(stats.umpVsAbs.overall.pct * 10) / 10,
      label: 'season overall',
      definition: 'agreement with our ABS reconstruction on 2026 called pitches',
      approx: false,
    });
    expect(await serve(withFile('stats.json', undefined)).source.umpFigure()).toBeNull();
  });

  it('is what ?pool=season opens, ready at once with the deal box as its lens and nothing fetched', async () => {
    const fetched = vi.fn(() => Promise.reject(new Error('nothing should load yet')));

    vi.stubGlobal('fetch', fetched);
    const source = await openSource(sourceIdOf('season'), '/');

    expect(source).toMatchObject({ id: 'season-2026', label: '2026 season', lensPoints: boxLensPoints() });
    expect(fetched).not.toHaveBeenCalled();
    expect(sourceIdOf(null)).toBe('season-2026');
  });
});

describe('the season lens (§4.6)', () => {
  it('frames every crossing inside the deal box, as a lens fitted to its edges', () => {
    const { xMax, zMin, zMax } = DEAL_BOX;
    const inside = Array.from({ length: 21 * 19 }, (_, i) => ({
      x: -xMax + 1e-6 + ((2 * xMax - 2e-6) * (i % 21)) / 20,
      z: zMin + 1e-6 + ((zMax - zMin - 2e-6) * Math.floor(i / 21)) / 18,
    }));
    const box = createLens(boxLensPoints());
    const both = createLens([...boxLensPoints(), ...inside]);

    for (const [W, H] of [[1440, 900], [390, 664]]) {
      for (const side of ['L', 'R'] as const) expect(both.fitCam(W, H, side).F).toBeCloseTo(box.fitCam(W, H, side).F, 9);
    }
  });
});

describe('?date=', () => {
  it('takes a real calendar date written YYYY-MM-DD, and nothing else', () => {
    expect(['2026-11-14', '2028-02-29'].map(isDateKey)).toEqual([true, true]);
    expect(['2026-02-30', '2027-02-29', '2026-13-01', '2026-11-4', '20261114', 'today', ''].map(isDateKey)).toEqual(Array(7).fill(false));
  });
});
