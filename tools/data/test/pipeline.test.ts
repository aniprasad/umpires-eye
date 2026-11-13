import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePitches, type ShardDoc } from '../lib/decode.ts';
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
// A strike the batter challenged and a ball the catcher challenged, both upheld.
const challenges = new Map([
  [3, challenge(11, AWAY, false)],
  [8, challenge(30, HOME, false)],
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
          officialDate: '2026-05-01',
          status: { abstractGameState: 'Final', codedGameState: 'F', detailedState: 'Final' },
          teams: { away: { team: { id: AWAY } }, home: { team: { id: HOME } } },
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
  assert.deepEqual(stats.challenges.absAgreesWithFinalCall, { agree: 2, total: 2, pct: 100 });
  assert.equal(stats.umpVsAbs.overall.pct, 100);
  assert.equal(JSON.parse(first.files.get(REPORT_PATH) ?? '{}').integrity.challengeRoleAnomalies.count, 0);
  assert.equal(manifest.pool.close, 24);
  assert.equal(manifest.pool.near, 3);
  assert.equal(manifest.pool.calibrators, 3);
  assert.equal(pitches.length, 30);
  assert.ok(pitches.every((p) => p.dealable));
  assert.deepEqual(shard.players.map((r) => r[0]).sort(), [11, 20, 30]);
  assert.match(shard.credit, /Not affiliated with MLB/);
});
