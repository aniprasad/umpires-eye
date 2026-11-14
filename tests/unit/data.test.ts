import { afterEach, describe, expect, it, vi } from 'vitest';
import { CREDIT, PLATE_HALF } from '../../src/core/rules.ts';
import { LoadError, type LoadErrorKind } from '../../src/data/source';
import { sourceIdOf } from '../../src/data/sources';
import { fromPoolFile, loadWorldSeries, worldSeriesSource, WS_LABEL, WS_TODAY_IDS, type PoolPitch } from '../../src/data/ws2026';
import { playPoints } from '../../src/math/deal';
import { countWords, fmtHeight, marginPhrase, resultText, toughest } from '../../src/math/words';
import { judged } from '../../src/math/flow';
import { prep } from '../../src/math/kinematics';
import { poolPitch, synthPitch } from './fixtures';

const game = { gamePk: 1, gameNumber: 1, date: '2026-10-23', away: 'AWY', home: 'HOM' };
const todayPool = (): PoolPitch[] => WS_TODAY_IDS.map((id) => poolPitch({ id }));

describe('the World Series source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns Today's Ten in play order from the pool", () => {
    const pitches = [...WS_TODAY_IDS].reverse().map((id) => poolPitch({ id }));
    const data = fromPoolFile({ games: [game], pitches });

    expect(data.label).toBe(WS_LABEL);
    expect(data.today.map((p) => p.id)).toEqual([...WS_TODAY_IDS]);
    expect(data.pitches).toHaveLength(10);
  });

  it("refuses a pool without one of Today's Ten, naming it", () => {
    const pitches = WS_TODAY_IDS.slice(1).map((id) => poolPitch({ id }));

    expect(() => fromPoolFile({ games: [game], pitches })).toThrow(WS_TODAY_IDS[0]);
  });

  it("gives each pitch its game, its game's plate umpire and its played order, in place of the game number", () => {
    const g5 = { gamePk: 5, gameNumber: 5, date: '2026-10-28', away: 'MIL', home: 'TB', venue: 'Tropicana Field', plateUmpire: 'Vic Carapazza' };
    const p = fromPoolFile({ games: [game, g5], pitches: [...todayPool(), poolPitch({ id: '5-12-3', gamePk: 5, gameNumber: 5 })] }).pitches.at(-1);

    expect(p?.game).toEqual({ gamePk: 5, date: '2026-10-28', away: 'MIL', home: 'TB', label: '2026 World Series · Game 5', seriesGame: 5, venue: 'Tropicana Field' });
    expect(p?.plateUmpire).toBe('Vic Carapazza');
    expect(p?.order).toBe(5_001_203);
    expect(p).not.toHaveProperty('gameNumber');
  });

  it('serves its one ten whatever the date, and one deck of the playable pitches left', async () => {
    const offPlate = poolPitch({ id: '1-90-1', mid: { x: 2, z: 2.5, t: 0.38 } });
    const ws = fromPoolFile({ games: [game], pitches: [...todayPool(), offPlate, poolPitch({ id: '1-91-1' })] });
    const source = worldSeriesSource(ws);
    const deck = await source.deck();

    expect(await source.today('2031-01-01')).toEqual({ kind: 'ten', dateKey: '2031-01-01', pitches: ws.today });
    expect(deck.pitches.map((p) => p.id)).toEqual(['1-91-1']);
    expect(await deck.next()).toBeNull();
    expect(source.lensPoints).toEqual(playPoints(ws.today, ws.pitches));
    expect(await source.umpFigure()).toMatchObject({ pct: 94, approx: true });
  });

  it('rejects with the kind of failure the start screen needs, and words that say what went wrong', async () => {
    const file = { games: [game], pitches: todayPool() };
    const cases: [Response | Error, LoadErrorKind, RegExp][] = [
      [new Response('Not Found', { status: 404, statusText: 'Not Found' }), 'missing', /^Could not load the pitch data \(404 Not Found\)\.$/],
      [new Response('', { status: 503, statusText: 'Service Unavailable' }), 'network', /\(503 Service Unavailable\)/],
      [new TypeError('Failed to fetch'), 'network', /^Could not reach the pitch data \(Failed to fetch\)\.$/],
      [new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }), 'missing', /web page/],
      [new Response('{"games": ['), 'data', /JSON/],
      [Response.json(null), 'data', /^The pitch data has no games or no pitches\.$/],
      [Response.json({ ...file, pitches: file.pitches.slice(1) }), 'data', new RegExp(`^Today's Ten pitches are missing from the pool: ${WS_TODAY_IDS[0]}$`)],
      [Response.json({ ...file, games: [] }), 'data', /isn't in the pool's games/],
    ];

    vi.useFakeTimers();
    for (const [answer, kind, words] of cases) {
      vi.stubGlobal('fetch', () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone())));
      const got = loadWorldSeries('pool.json').catch((err: unknown) => err);

      // past the helper's retries
      await vi.runAllTimersAsync();
      const e = await got;

      expect(e).toBeInstanceOf(LoadError);
      expect(e).toMatchObject({ kind, message: expect.stringMatching(words) });
    }
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json(file)));
    expect((await loadWorldSeries('pool.json')).id).toBe('ws-2026');
  });

  it('refuses a pool body that is null or not an object as broken data, not a crash', () => {
    for (const body of [null, undefined, 42, 'pool', []]) {
      expect(() => fromPoolFile(body)).toThrow(new LoadError('data', 'The pitch data has no games or no pitches.'));
    }
  });

  it('is what ?pool=ws opens, and what the self-test reads without a ?pool=', () => {
    expect([sourceIdOf('ws'), sourceIdOf('ws', true), sourceIdOf(null, true)]).toEqual(['ws-2026', 'ws-2026', 'ws-2026']);
  });

  it('gives way to the 2026 season as the default', () => {
    expect([sourceIdOf(null), sourceIdOf('nonsense'), sourceIdOf('season', true)]).toEqual(['season-2026', 'season-2026', 'season-2026']);
  });
});

describe('words on the reveal and the card', () => {
  it('writes heights the way a matchup card does', () => {
    expect(fmtHeight(6.0833)).toBe('6′1″');
    expect(fmtHeight(5.9999)).toBe('6′0″');
  });

  it("says the indicator's count with one ball, strike or out where there's one", () => {
    expect(countWords(1, 1, 1)).toBe('Count 1 ball, 1 strike, 1 out');
    expect(countWords(0, 2, 3)).toBe('Count 0 balls, 2 strikes, 3 outs');
  });

  it('names the edge a close strike caught, and which way a ball missed', () => {
    const z = 3.2 + 0.05;
    const strike = prep(synthPitch({ traj: { x0: 0, y0: 50, z0: z, vX0: 0, vY0: -130, vZ0: 0, aX: 0, aY: 0, aZ: 0 } }));
    const ball = prep(synthPitch({ traj: { x0: PLATE_HALF + 0.5, y0: 50, z0: 2.4, vX0: 0, vY0: -130, vZ0: 0, aX: 0, aY: 0, aZ: 0 } }));

    expect(marginPhrase(strike)).toMatch(/^Caught the top of the zone by \d\.\d\u00a0in$/);
    expect(marginPhrase(ball)).toMatch(/^Missed away by \d\.\d\u00a0in$/);
  });

  it('says nothing got by you on a perfect round', () => {
    const P = prep(synthPitch());

    expect(toughest([judged(P, 'strike')])).toBe('Nothing got by you');
    expect(toughest([judged(P, 'ball')])).toMatch(/^Four-Seam Fastball, /);
  });

  it('ends the copied result with the data credit', () => {
    const set = [prep(synthPitch())];
    const text = resultText({ label: WS_LABEL, roundLabel: "Today's Ten", figure: null, set, results: [judged(set[0], 'strike')] });

    expect(CREDIT).toMatch(/MLB Stats API/);
    expect(text.split('\n').at(-1)).toContain(CREDIT);
  });
});
