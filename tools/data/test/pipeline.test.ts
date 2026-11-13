import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeGames, decodePitches, type ShardDoc } from '../lib/decode.ts';
import type { PlayByPlay, ScheduleResponse } from '../lib/mlb.ts';
import { buildDataset, OUT_DIR, REPORT_PATH } from '../lib/pipeline.ts';
import { AWAY, challenge, HOME, person, peopleOf, pitch, play, xForMargin } from './fixtures.ts';

// One synthetic game: every plate appearance is a single called pitch put at a chosen distance from the edge.
const margins = [
  ...Array.from({ length: 24 }, (_, k) => (k % 2 ? 1 : -1) * (0.05 + k * 0.05)),
  2,
  -3.2,
  4.1,
  -5,
  ...Array.from({ length: 12 }, (_, k) => (k % 2 ? 7 : -7) - k * 0.05),
];
// A strike the batter challenged and two balls the catcher challenged, all upheld; the second ball is 5 in out, between
// the near and calibrator bands.
const challenges = new Map([
  [3, challenge(11, AWAY, false)],
  [8, challenge(30, HOME, false)],
  [27, challenge(30, HOME, false)],
]);
const plays = margins.map((m, k) => {
  const review = challenges.get(k);

  return play({
    atBat: k,
    batter: 11,
    events: [pitch(0, 1, { code: m >= 0 ? 'C' : 'B', after: m >= 0 ? [0, 1] : [1, 0], x: xForMargin(m), ...(review ? { review } : {}) })],
  });
});
const schedule: ScheduleResponse = {
  dates: [
    {
      games: [
        {
          gamePk: 900001,
          gameType: 'R',
          gameDate: '2026-05-01T23:05:00Z',
          officialDate: '2026-05-01',
          status: { abstractGameState: 'Final', codedGameState: 'F', detailedState: 'Final' },
          teams: { away: { team: { id: AWAY } }, home: { team: { id: HOME } } },
          venue: { id: 32, name: 'A Park' },
          officials: [{ official: { id: 70, fullName: 'Plate Ump' }, officialType: 'Home Plate' }],
        },
      ],
    },
  ],
};
const inputs = {
  teams: { teams: [{ id: AWAY, abbreviation: 'AWY', name: 'Away Club' }, { id: HOME, abbreviation: 'HOM', name: 'Home Club' }] },
  schedules: [schedule],
  people: peopleOf(person(11), person(30, { position: 'C' })),
  loadPlays: (pk: number): PlayByPlay | null => (pk === 900001 ? { allPlays: plays } : null),
};

test('a synthetic season builds into a manifest, stats, one dealable shard and a report, deterministically', () => {
  const first = buildDataset(inputs);
  const again = buildDataset(inputs);
  const manifest = JSON.parse(first.files.get(`${OUT_DIR}/manifest.json`) ?? '{}');
  const stats = JSON.parse(first.files.get(`${OUT_DIR}/stats.json`) ?? '{}');
  const shard = JSON.parse(first.files.get(`${OUT_DIR}/shards/00.json`) ?? '{}') as ShardDoc;
  const pitches = decodePitches(shard);

  assert.deepEqual([...first.files.keys()].sort(), [`${OUT_DIR}/manifest.json`, `${OUT_DIR}/shards/00.json`, `${OUT_DIR}/stats.json`, REPORT_PATH]);
  assert.deepEqual([...again.files], [...first.files]);
  assert.equal(stats.calledPitches.total, margins.length);
  assert.deepEqual(stats.challenges.absAgreesWithFinalCall, { agree: 3, total: 3, pct: 100 });
  assert.equal(stats.umpVsAbs.overall.pct, 100);
  assert.equal(JSON.parse(first.files.get(REPORT_PATH) ?? '{}').integrity.challengeRoleAnomalies.count, 0);
  assert.deepEqual(
    [manifest.pool.close, manifest.pool.near, manifest.pool.mid, manifest.pool.calibrators, manifest.pool.dealable],
    [24, 3, 1, 3, 31],
  );
  assert.equal(pitches.length, 31);
  assert.ok(pitches.every((p) => p.dealable));
  assert.deepEqual(shard.players.map((r) => r[0]).sort(), [11, 20, 30]);
  assert.deepEqual(
    decodeGames(shard).map((g) => [g.start, g.venue]),
    [['2026-05-01T23:05:00Z', 32]],
  );
  assert.ok(pitches.every((p) => p.umpire === 70));
  assert.deepEqual([shard.venues, shard.umpires], [[[32, 'A Park']], [[70, 'Plate Ump']]]);
  assert.match(shard.credit, /Not affiliated with MLB/);
});

test('the build fails on an integrity finding that is not on the allowlist', () => {
  // The feed's count after the first pitch, a ball, says 0-1.
  const broken = [play({ atBat: 0, batter: 11, events: [pitch(0, 1, { code: 'B', after: [0, 1], x: xForMargin(-0.05) })] }), ...plays.slice(1)];

  assert.throws(() => buildDataset({ ...inputs, loadPlays: () => ({ allPlays: broken }) }), /1 integrity findings outside the allowlist.*900001-0-1/);
});
