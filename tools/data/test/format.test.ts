import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absJudge } from '../../../src/core/abs.ts';
import { decodeGames, decodeNames, decodePitches } from '../../../src/core/decode.ts';
import { crossing, quickEnough } from '../../../src/core/kinematics.ts';
import { BALL_R, MAX_FLIGHT_S, PLATE_FRONT_Y, PLATE_HALF, RUBBER_Y } from '../../../src/core/rules.ts';
import {
  CHALLENGE_FIELDS,
  GAME_FIELDS,
  NAME_FIELDS,
  PITCH_FIELDS,
  PLAYER_FIELDS,
  type ShardDoc,
} from '../../../src/core/schema.ts';
import { gameRow, pitchRow, quantize, round, roundTraj, rowsJson } from '../lib/format.ts';
import { judge } from '../lib/judge.ts';
import type { CalledPitch } from '../lib/plays.ts';
import { GAME, HOME, judged, trajThrough, ZONE } from './fixtures.ts';

test('round gives short decimals that survive JSON', () => {
  assert.equal(JSON.stringify([round(-132.16891234, 4), round(0.30004, 4), round(2.6751, 2)]), '[-132.1689,0.3,2.68]');
});

test('quantize keeps four decimals unless rounding would flip the call', () => {
  const ordinary = judged({ seq: 1, marginIn: 0.8 });
  const hair = judged({ seq: 2, marginIn: 0 });
  const edge: CalledPitch = { ...hair.p, traj: trajThrough(PLATE_HALF + BALL_R - 1e-7, 2.5) };
  const j = judge(edge, 2);
  const q = quantize(j);
  const mid = crossing(q.traj);

  assert.equal(quantize(ordinary).decimals, 4);
  assert.equal(j.truth, 'S');
  assert.notEqual(q.decimals, 4);
  assert.equal(absJudge(mid.x, mid.z, q.zoneTop, q.zoneBottom).strike, true);
});

test('quantize keeps more decimals when rounding the extension would push a pitch past the flight-time bound', () => {
  // Steady speed, so flight time is distance over speed: 1e-5 s inside the bound at an extension of 6.5049 ft, and
  // outside it once that rounds to 6.50, which moves release 0.0049 ft farther from the plate.
  const extension = 6.5049;
  const speed = (RUBBER_Y - extension - PLATE_FRONT_Y) / (MAX_FLIGHT_S - 1e-5);
  const traj = { x0: 0, y0: 50, z0: 2.5, vX0: 0, vY0: -speed, vZ0: 0, aX: 0, aY: 0, aZ: 0 };
  const j = judge({ ...judged({ seq: 1, marginIn: 0.8 }).p, traj, extension }, 1);
  const q = quantize(j);

  assert.equal(j.showable, true);
  assert.equal(quickEnough(roundTraj(traj, 4), round(extension, 2)), false);
  assert.deepEqual([q.decimals, q.extension], [5, 6.505]);
  assert.equal(q.extension !== null && quickEnough(q.traj, q.extension), true);
});

test('a pitch row decodes back to the same pitch', () => {
  const j = judged({ seq: 3, marginIn: -1.234, challenged: true });
  const row = pitchRow(j, quantize(j), true, (id) => (id === 2 ? 'HOM' : 'AWY'));
  const doc = JSON.parse(
    rowsJson({ format: 'x', fields: { games: GAME_FIELDS, players: PLAYER_FIELDS, pitches: PITCH_FIELDS, challenge: CHALLENGE_FIELDS } }, [
      ['games', []],
      ['players', []],
      ['pitches', [row]],
    ]),
  ) as ShardDoc;
  const [p] = decodePitches(doc);

  assert.ok(p);
  assert.equal(p.id, j.p.id);
  assert.equal(p.umpire, 70);
  assert.deepEqual([p.ump, p.final, p.abs, p.marginIn, p.dealable], ['B', 'B', 'B', -1.23, true]);
  assert.deepEqual(p.challenge, { by: 30, team: 'HOM', role: 'C', overturned: false });
  assert.deepEqual([p.zoneTop, p.zoneBottom], [ZONE.top, ZONE.bottom]);
  assert.ok(Math.abs(p.traj.x0 - j.p.traj.x0) <= 5e-5);
});

test('a game row decodes back with its start and venue', () => {
  const game = { ...GAME, gameType: 'W' as const, series: 'World Series', seriesGame: 5, venue: { id: 32, name: 'A Park' } };
  const doc = JSON.parse(
    rowsJson({ fields: { games: GAME_FIELDS, venues: NAME_FIELDS } }, [
      ['games', [gameRow(game, (id) => (id === HOME ? 'HOM' : 'AWY'))]],
      ['venues', [[32, 'A Park']]],
    ]),
  ) as ShardDoc;

  assert.deepEqual(decodeGames(doc), [
    {
      gamePk: 900001,
      date: '2026-05-01',
      start: '2026-05-01T23:05:00Z',
      gameType: 'W',
      away: 'AWY',
      home: 'HOM',
      series: 'World Series',
      seriesGame: 5,
      venue: 32,
    },
  ]);
  assert.equal(decodeNames(doc, 'venues').get(32), 'A Park');
});

test('rowsJson writes valid JSON with one row per line', () => {
  const text = rowsJson({ a: 1 }, [
    ['rows', [[1, 'x', null], [2, 'y', [3]]]],
    ['empty', []],
  ]);

  assert.deepEqual(JSON.parse(text), { a: 1, rows: [[1, 'x', null], [2, 'y', [3]]], empty: [] });
  assert.equal(text.split('\n').filter((l) => l.startsWith('[')).length, 2);
});
