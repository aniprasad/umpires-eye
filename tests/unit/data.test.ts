import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLATE_HALF } from '../../src/core/rules.ts';
import { LoadError, type LoadErrorKind } from '../../src/data/source';
import { sourceIdOf } from '../../src/data/sources';
import { fromPoolFile, loadWorldSeries, worldSeriesSource, WS_LABEL, WS_TODAY_IDS, type PoolPitch } from '../../src/data/ws2026';
import { playPoints } from '../../src/math/deal';
import { fmtHeight, marginPhrase, resultText, toughest } from '../../src/math/words';
import { judged } from '../../src/math/flow';
import { prep } from '../../src/math/kinematics';
import { poolPitch, synthPitch } from './fixtures';

const game = { gamePk: 1, gameNumber: 1, date: '2026-10-23', away: 'AWY', home: 'HOM' };
const todayPool = (): PoolPitch[] => WS_TODAY_IDS.map((id) => poolPitch({ id }));

describe('the World Series source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("gives each pitch its game, its game's plate umpire and M1's played order, in place of the game number", () => {
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

  it("rejects with the kind of failure the start screen needs, in M1's words", async () => {
    const file = { games: [game], pitches: todayPool() };
    const cases: [Response | Error, LoadErrorKind, RegExp][] = [
      [new Response('Not Found', { status: 404, statusText: 'Not Found' }), 'missing', /^Could not load the pitch data \(404 Not Found\)\.$/],
      [new Response('', { status: 503, statusText: 'Service Unavailable' }), 'network', /\(503 Service Unavailable\)/],
      [new TypeError('Failed to fetch'), 'network', /^Could not reach the pitch data \(Failed to fetch\)\.$/],
      [new Response('<!doctype html>'), 'data', /JSON/],
      [Response.json({ ...file, pitches: file.pitches.slice(1) }), 'data', new RegExp(`^Today's Ten pitches are missing from the pool: ${WS_TODAY_IDS[0]}$`)],
      [Response.json({ ...file, games: [] }), 'data', /isn't in the pool's games/],
    ];

    for (const [answer, kind, words] of cases) {
      vi.stubGlobal('fetch', () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
      const e = await loadWorldSeries('pool.json').catch((err: unknown) => err);

      expect(e).toBeInstanceOf(LoadError);
      expect(e).toMatchObject({ kind, message: expect.stringMatching(words) });
    }
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json(file)));
    expect((await loadWorldSeries('pool.json')).id).toBe('ws-2026');
  });

  it('is what ?pool=ws opens, and still the default', () => {
    expect([sourceIdOf('ws'), sourceIdOf(null), sourceIdOf('nonsense')]).toEqual(['ws-2026', 'ws-2026', 'ws-2026']);
  });
});

describe('words on the reveal and the card', () => {
  it('writes heights the way a matchup card does', () => {
    expect(fmtHeight(6.0833)).toBe('6′1″');
    expect(fmtHeight(5.9999)).toBe('6′0″');
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

  it('ends the copied result with the data credit AGENTS.md requires', () => {
    const rules = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');
    const credit = /Credit the data: "([^"]+)"/.exec(rules)?.[1];
    const set = [prep(synthPitch())];
    const text = resultText({ label: WS_LABEL, roundLabel: "Today's Ten", set, results: [judged(set[0], 'strike')] });

    expect(credit).toMatch(/MLB Stats API/);
    expect(text.split('\n').at(-1)).toContain(credit);
  });
});
