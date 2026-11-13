import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayByPlay, PlayEvent } from '../lib/mlb.ts';
import { extractGame } from '../lib/plays.ts';
import { plateChanged, plateRuns } from '../lib/umpires.ts';
import { action, GAME, peopleOf, pitch, play } from './fixtures.ts';

const NO_UMPIRE = 433417;
const names = new Map([
  [70, 'Alfonso Márquez'],
  [71, 'Erich Bacchus'],
  [72, 'Rob Drake'],
  [73, 'Steven Jaschinski'],
  [74, 'Stu Scheurwater'],
  [75, 'Jansen Visconti'],
  [76, 'Cory Blaser'],
  [77, 'Ryan Wills'],
  [NO_UMPIRE, 'NO UMPIRE'],
]);
const game = { ...GAME, scheduledUmpire: { id: 70, name: 'Alfonso Márquez' } };

const ump = (index: number, id: number, description: string): PlayEvent =>
  action(index, 'umpire_substitution', { umpire: { id }, details: { eventType: 'umpire_substitution', description } });
const extract = (plays: PlayByPlay['allPlays']) => extractGame({ allPlays: plays }, game, peopleOf(), names);
const umpires = (plays: PlayByPlay['allPlays']) => extract(plays).pitches.map((p) => [p.id, p.umpireId]);

test('an umpire who moves to the plate mid plate appearance calls the pitches after the move', () => {
  // The second change only empties the base Bacchus left, though it says HP.
  const { pitches, plate, checks } = extract([
    play({ atBat: 0, events: [pitch(0, 1, { code: 'B', after: [1, 0] })] }),
    play({
      atBat: 1,
      events: [
        pitch(0, 1, { code: 'B', after: [1, 0] }),
        ump(1, 71, 'Umpire Erich Bacchus moving to HP.'),
        ump(2, NO_UMPIRE, 'Umpire change: NO UMPIRE replaces HP umpire Erich Bacchus.'),
        pitch(3, 2, { code: 'C', after: [1, 1] }),
      ],
    }),
  ]);

  assert.deepEqual(
    pitches.map((p) => [p.id, p.umpireId]),
    [
      ['900001-0-1', 70],
      ['900001-1-1', 70],
      ['900001-1-2', 71],
    ],
  );
  assert.deepEqual(
    plate.events.map((e) => [e.atBat, e.afterPitch, e.reading]),
    [
      [1, 1, 'takes-plate'],
      [1, 1, 'former-slot'],
    ],
  );
  assert.deepEqual(plateRuns(plate).map((r) => [r.umpireId, r.called]), [
    [70, 2],
    [71, 1],
  ]);
  assert.deepEqual(checks.umpireProblems, []);
});

test('a replacement naming someone who took the plate earlier in the play fills his former slot (824398)', () => {
  // Drake goes from third to the plate; Jaschinski slides from second to third and second is left empty.
  const { pitches, plate } = extract([
    play({
      atBat: 0,
      events: [
        ump(0, 72, 'Umpire Rob Drake moving to HP.'),
        ump(1, 74, 'Umpire Stu Scheurwater moving to 1B.'),
        ump(2, NO_UMPIRE, 'Umpire change: NO UMPIRE replaces umpire Steven Jaschinski.'),
        ump(3, 73, 'Umpire change: Steven Jaschinski replaces HP umpire Rob Drake.'),
        pitch(4, 1, { code: 'B', after: [1, 0] }),
      ],
    }),
  ]);

  assert.deepEqual(
    pitches.map((p) => p.umpireId),
    [72],
  );
  assert.deepEqual(
    plate.events.map((e) => e.reading),
    ['takes-plate', 'base', 'base', 'former-slot'],
  );
});

test('a change without a position replaces the plate umpire when it names him, in either order of the chain', () => {
  // Blaser takes the plate from Márquez, Visconti takes Blaser's base and Visconti's base is left empty (824289).
  const chain = [
    'Umpire change: NO UMPIRE replaces umpire Jansen Visconti.',
    'Umpire change: Jansen Visconti replaces umpire Cory Blaser.',
    'Umpire change: Cory Blaser replaces umpire Alfonso Marquez.',
  ];
  const ids = [NO_UMPIRE, 75, 76];
  const events = (order: number[]) => [...order.map((k, i) => ump(i, ids[k] ?? 0, chain[k] ?? '')), pitch(3, 1, { code: 'B', after: [1, 0] })];

  assert.deepEqual(umpires([play({ atBat: 0, events: events([0, 1, 2]) })]), [['900001-0-1', 76]]);
  assert.deepEqual(umpires([play({ atBat: 0, events: events([2, 1, 0]) })]), [['900001-0-1', 76]]);
  assert.deepEqual(
    extract([play({ atBat: 0, events: events([2, 1, 0]) })]).plate.events.map((e) => e.reading),
    ['replaces-plate', 'former-slot', 'base'],
  );
});

test('a plate change that contradicts the plate umpire on record names no one for the game so far (824716)', () => {
  // The schedule has Márquez at the plate and Wills at second, yet the log replaces "HP umpire Ryan Wills".
  const vacated = extract([
    play({ atBat: 0, events: [pitch(0, 1, { code: 'B', after: [1, 0] })] }),
    play({
      atBat: 1,
      events: [
        ump(0, 77, 'Umpire Ryan Wills moving to 2B.'),
        ump(1, NO_UMPIRE, 'Umpire change: NO UMPIRE replaces HP umpire Ryan Wills.'),
        pitch(2, 1, { code: 'B', after: [1, 0] }),
      ],
    }),
  ]);
  // When someone real comes in, he is named from then on.
  const replaced = umpires([
    play({ atBat: 0, events: [pitch(0, 1, { code: 'B', after: [1, 0] })] }),
    play({
      atBat: 1,
      events: [ump(0, 76, 'Umpire change: Cory Blaser replaces HP umpire Ryan Wills.'), pitch(1, 1, { code: 'B', after: [1, 0] })],
    }),
  ]);

  assert.deepEqual(
    vacated.pitches.map((p) => p.umpireId),
    [null, null],
  );
  assert.deepEqual(
    vacated.plate.events.map((e) => e.reading),
    ['base', 'conflict'],
  );
  assert.equal(plateChanged(vacated.plate), true);
  assert.deepEqual(replaced, [
    ['900001-0-1', null],
    ['900001-1-1', 76],
  ]);
});

test('base changes leave the plate alone, and an unreadable change or a wrong id is a problem', () => {
  const quiet = extract([
    play({
      atBat: 0,
      events: [
        ump(0, 74, 'Umpire Stu Scheurwater moving to 1B.'),
        ump(1, NO_UMPIRE, 'Umpire change: NO UMPIRE replaces 1B umpire Stu Scheurwater.'),
        pitch(2, 1, { code: 'B', after: [1, 0] }),
      ],
    }),
  ]);
  const odd = extract([
    play({
      atBat: 0,
      events: [ump(0, 72, 'Umpire Erich Bacchus moving to HP.'), ump(1, 71, 'Umpires confer.'), pitch(2, 1, { code: 'B', after: [1, 0] })],
    }),
  ]);

  assert.deepEqual(
    quiet.pitches.map((p) => p.umpireId),
    [70],
  );
  assert.equal(plateChanged(quiet.plate), false);
  assert.deepEqual(
    odd.pitches.map((p) => p.umpireId),
    [null],
  );
  assert.equal(odd.checks.umpireProblems.length, 2);
});
