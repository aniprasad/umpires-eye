import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScheduleGame } from '../lib/mlb.ts';
import { parseHeightIn, toPerson } from '../lib/people.ts';
import { parseSchedule, parseTeams } from '../lib/schedule.ts';

const listing = (gamePk: number, date: string, coded: string, extra: Partial<ScheduleGame> = {}): ScheduleGame => ({
  gamePk,
  gameType: 'R',
  officialDate: date,
  status: { abstractGameState: 'Final', codedGameState: coded, detailedState: coded === 'F' ? 'Final' : coded === 'D' ? 'Postponed' : 'Cancelled' },
  teams: { away: { team: { id: 1 } }, home: { team: { id: 2 } } },
  ...extra,
});

test('parseSchedule keeps each completed game once, from its final listing, in date order', () => {
  const { games, skipped } = parseSchedule([
    {
      dates: [
        { games: [listing(3, '2026-04-02', 'F'), listing(1, '2026-04-02', 'D')] },
        { games: [listing(1, '2026-04-20', 'F'), listing(2, '2026-04-21', 'C')] },
      ],
    },
    {
      dates: [
        {
          games: [
            listing(9, '2026-10-28', 'F', { gameType: 'W', seriesDescription: 'World Series', seriesGameNumber: 5 }),
            listing(8, '2026-03-01', 'F', { gameType: 'S' }),
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(
    games.map((g) => [g.gamePk, g.date, g.gameType, g.series, g.seriesGame]),
    [
      [3, '2026-04-02', 'R', null, null],
      [1, '2026-04-20', 'R', null, null],
      [9, '2026-10-28', 'W', 'World Series', 5],
    ],
  );
  assert.deepEqual(skipped, { Cancelled: 1, 'game type S': 1 });
});

test('parseSchedule takes the venue and the home-plate umpire when the schedule lists them', () => {
  const crew = [
    { official: { id: 71, fullName: 'First Base Ump' }, officialType: 'First Base' },
    { official: { id: 70, fullName: 'Plate Ump' }, officialType: 'Home Plate' },
  ];
  const { games } = parseSchedule([
    {
      dates: [
        {
          games: [
            listing(1, '2026-04-02', 'F', { venue: { id: 32, name: 'A Park' }, officials: crew }),
            listing(2, '2026-04-02', 'F', { officials: crew.slice(0, 1) }),
          ],
        },
      ],
    },
  ]);

  assert.deepEqual(
    games.map((g) => [g.venue, g.umpire]),
    [
      [{ id: 32, name: 'A Park' }, { id: 70, name: 'Plate Ump' }],
      [null, null],
    ],
  );
});

test('parseTeams maps ids to abbreviations', () => {
  const teams = parseTeams({ teams: [{ id: 158, abbreviation: 'MIL', name: 'Milwaukee Brewers' }, { id: 1 }] });

  assert.deepEqual([...teams.values()], [{ id: 158, abbr: 'MIL', name: 'Milwaukee Brewers' }]);
});

test('roster heights parse to inches', () => {
  assert.equal(parseHeightIn('6\' 1"'), 73);
  assert.equal(parseHeightIn("5' 11\""), 71);
  assert.equal(parseHeightIn("6'"), 72);
  assert.equal(parseHeightIn(undefined), null);
  assert.equal(parseHeightIn('tall'), null);
});

test('toPerson keeps what the build needs', () => {
  assert.deepEqual(
    toPerson({ id: 5, fullName: 'A Catcher', height: '6\' 2"', primaryPosition: { abbreviation: 'C' }, batSide: { code: 'S' }, pitchHand: { code: 'R' } }),
    { id: 5, name: 'A Catcher', heightIn: 74, bats: 'S', throws: 'R', position: 'C' },
  );
});
