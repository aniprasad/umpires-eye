import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PlayByPlay } from '../lib/mlb.ts';
import { extractGame, peopleIdsIn, type CalledPitch } from '../lib/plays.ts';
import { action, AWAY, challenge, GAME, HOME, person, peopleOf, pitch, play, runner } from './fixtures.ts';

const extract = (plays: PlayByPlay['allPlays'], people = peopleOf()) => extractGame({ allPlays: plays }, GAME, people);
const state = (p: CalledPitch) => [p.outs, p.balls, p.strikes, p.bases, p.awayScore, p.homeScore];

describe('called pitches', () => {
  test('keeps tracked balls and called strikes, and counts what it leaves out', () => {
    const { pitches, checks } = extract([
      play({
        atBat: 0,
        events: [
          pitch(0, 1, { code: 'B', after: [1, 0] }),
          pitch(1, 2, { code: 'C', after: [1, 1] }),
          pitch(2, 3, { code: 'S', after: [1, 2] }),
          pitch(3, 4, { code: '*B', after: [2, 2] }),
          pitch(4, 5, { code: 'B', after: [3, 2], description: 'Automatic Ball - Pitcher Pitch Timer Violation' }),
          pitch(5, 6, { code: 'F', after: [3, 2] }),
          pitch(6, 7, { code: 'B', after: [4, 2], tracked: false }),
        ],
      }),
    ]);

    assert.deepEqual(
      pitches.map((p) => [p.id, p.umpCall, p.finalCall]),
      [
        ['900001-0-1', 'B', 'B'],
        ['900001-0-2', 'S', 'S'],
      ],
    );
    assert.equal(checks.pitchEvents, 7);
    assert.equal(checks.calledCodes, 4);
    assert.deepEqual([checks.ballInDirt, checks.automatic, checks.noTracking], [1, 1, 1]);
    assert.deepEqual(checks.countMismatches, []);
  });

  test('flags a count that does not follow from the call', () => {
    const { checks } = extract([play({ atBat: 0, events: [pitch(0, 1, { code: 'B', after: [0, 1] })] })]);

    assert.equal(checks.countMismatches.length, 1);
  });
});

describe('game state before each pitch', () => {
  test('rebuilds outs, count, bases and score through steals, caught stealing and runs on wild pitches', () => {
    const { pitches, checks } = extract([
      play({
        atBat: 0,
        batter: 11,
        events: [
          pitch(0, 1, { code: 'B', after: [1, 0] }),
          pitch(1, 2, { code: 'B', after: [2, 0] }),
          pitch(2, 3, { code: 'B', after: [3, 0] }),
          pitch(3, 4, { code: 'B', after: [4, 0] }),
        ],
        runners: [runner(11, null, '1B', 3)],
        post: { first: 11 },
      }),
      play({
        atBat: 1,
        batter: 12,
        outs: 1,
        events: [
          pitch(0, 1, { code: 'C', after: [0, 1] }),
          action(1, 'caught_stealing_2b', { count: { balls: 0, strikes: 1, outs: 1 } }),
          pitch(2, 2, { code: 'B', after: [1, 1], outs: 1 }),
          pitch(3, 3, { code: 'X', after: [1, 1], outs: 1 }),
        ],
        runners: [runner(11, '1B', null, 1, true), runner(12, null, '2B', 3)],
        post: { second: 12 },
      }),
      play({
        atBat: 2,
        batter: 13,
        outs: 2,
        score: [1, 0],
        events: [
          pitch(0, 1, { code: 'B', after: [1, 0], outs: 1 }),
          action(1, 'wild_pitch'),
          action(2, 'passed_ball', { details: { eventType: 'passed_ball', awayScore: 1, homeScore: 0 } }),
          pitch(3, 2, { code: 'C', after: [1, 1], outs: 1 }),
          pitch(4, 3, { code: 'X', after: [1, 1], outs: 1 }),
        ],
        runners: [runner(12, '2B', '3B', 1), runner(12, '3B', 'score', 2), runner(13, null, null, 4, true)],
      }),
      play({ atBat: 3, top: false, batter: 21, pitcher: 30, score: [1, 0], events: [pitch(0, 1, { code: 'C', after: [0, 1] })] }),
    ]);

    assert.deepEqual(pitches.map(state), [
      [0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0],
      [0, 2, 0, 0, 0, 0],
      [0, 3, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0],
      [1, 0, 1, 0, 0, 0],
      [1, 0, 0, 2, 0, 0],
      [1, 1, 0, 0, 1, 0],
      [0, 0, 0, 0, 1, 0],
    ]);
    assert.deepEqual(pitches.map((p) => p.top), [true, true, true, true, true, true, true, true, false]);
    assert.deepEqual([checks.outsMismatches, checks.runnersMismatches, checks.scoreMismatches], [[], [], []]);
    assert.equal(checks.runnersChecked, 4);
  });

  test('puts the extra-innings runner on second before the first pitch', () => {
    const { pitches } = extract([
      play({ atBat: 70, inning: 9, top: false, events: [pitch(0, 1, { code: 'B', after: [1, 0] })], outs: 3 }),
      play({
        atBat: 71,
        inning: 10,
        events: [pitch(0, 1, { code: 'C', after: [0, 1] })],
        runners: [runner(55, null, '2B', 0)],
        post: { second: 55 },
      }),
    ]);

    assert.equal(pitches[1]?.bases, 2);
  });

  test('lets a pinch runner take over the base', () => {
    const { pitches, checks } = extract([
      play({ atBat: 0, batter: 11, events: [pitch(0, 1, { code: 'X', after: [0, 0] })], runners: [runner(11, null, '1B', 0)], post: { first: 11 } }),
      play({
        atBat: 1,
        batter: 12,
        events: [
          pitch(0, 1, { code: 'B', after: [1, 0] }),
          action(1, 'offensive_substitution', { player: { id: 77 }, replacedPlayer: { id: 11 }, position: { abbreviation: 'PR' } }),
          action(2, 'stolen_base_2b'),
          pitch(3, 2, { code: 'C', after: [1, 1] }),
        ],
        runners: [runner(77, '1B', '2B', 2)],
        post: { second: 77 },
      }),
    ]);

    assert.deepEqual(pitches.map((p) => p.bases), [1, 2]);
    assert.deepEqual(checks.runnersMismatches, []);
    assert.deepEqual(checks.midPaSubstitutions, []);
  });
});

describe('ABS challenges', () => {
  const people = peopleOf(person(30, { position: 'C' }), person(12));

  test('recover the original call from the final call', () => {
    const { pitches, checks } = extract(
      [
        play({
          atBat: 0,
          batter: 12,
          events: [
            pitch(0, 1, { code: 'C', after: [0, 1], review: challenge(30, HOME, true) }),
            pitch(1, 2, { code: 'C', after: [0, 2], review: challenge(12, AWAY, false) }),
            pitch(2, 3, { code: 'B', after: [1, 2], review: challenge(30, HOME, false, 'MA') }),
            pitch(3, 4, { code: 'C', after: [1, 3] }),
          ],
          review: challenge(30, HOME, true),
        }),
      ],
      people,
    );
    const calls = pitches.map((p) => [p.umpCall, p.finalCall, p.challenge?.role ?? null, p.challenge?.source ?? null]);

    assert.deepEqual(calls, [
      ['B', 'S', 'catcher', 'pitch'],
      ['S', 'S', 'batter', 'pitch'],
      ['B', 'B', null, null],
      ['B', 'S', 'catcher', 'play'],
    ]);
    assert.deepEqual([checks.roleAnomalies, checks.orphanReviews], [[], []]);
  });

  test('flag challenges that break the rules or cannot be placed', () => {
    const { checks } = extract(
      [
        play({
          atBat: 0,
          batter: 12,
          events: [pitch(0, 1, { code: 'B', after: [1, 0], review: challenge(12, AWAY, false) })],
          review: challenge(30, HOME, false),
        }),
        play({ atBat: 1, batter: 13, events: [pitch(0, 1, { code: '*B', after: [1, 0], review: challenge(30, HOME, false) })] }),
      ],
      people,
    );

    assert.equal(checks.roleAnomalies.length, 1);
    assert.equal(checks.orphanReviews.length, 1);
    assert.deepEqual(checks.challengesOnExcluded, ['900001-1-1 (*B)']);
  });
});

describe('mid plate-appearance substitutions', () => {
  const change = (replaced: boolean) =>
    play({
      atBat: 0,
      batter: 12,
      bats: 'R',
      pitcher: 21,
      throws: 'L',
      events: [
        pitch(0, 1, { code: 'B', after: [1, 0] }),
        action(1, 'pitching_substitution', { player: { id: 21 }, ...(replaced ? { replacedPlayer: { id: 20 } } : {}) }),
        pitch(2, 2, { code: 'C', after: [1, 1] }),
      ],
    });
  const people = peopleOf(person(12, { bats: 'S' }), person(20, { throws: 'R' }), person(21, { throws: 'L' }));

  test('credit earlier pitches to the replaced pitcher, and a switch hitter to the other side', () => {
    const { pitches, checks } = extract([change(true)], people);

    assert.deepEqual(
      pitches.map((p) => [p.pitcherId, p.throws, p.bats, p.attribution]),
      [
        [20, 'R', 'L', 'replaced'],
        [21, 'L', 'R', 'matchup'],
      ],
    );
    assert.equal(checks.midPaSubstitutions.length, 1);
  });

  test('mark earlier pitches uncertain when the feed does not say who was replaced', () => {
    const { pitches } = extract([change(false)], people);

    assert.deepEqual(
      pitches.map((p) => p.attribution),
      ['uncertain', 'matchup'],
    );
  });
});

test('peopleIdsIn lists batters, challengers and replaced players', () => {
  const ids = peopleIdsIn({
    allPlays: [
      play({
        atBat: 0,
        batter: 12,
        events: [
          pitch(0, 1, { code: 'C', after: [0, 1], review: challenge(30, HOME, true) }),
          action(1, 'pitching_substitution', { player: { id: 21 }, replacedPlayer: { id: 20 } }),
          pitch(2, 2, { code: 'C', after: [0, 2] }),
        ],
        review: challenge(31, HOME, true),
      }),
    ],
  });

  assert.deepEqual(
    [...ids].sort((a, b) => a - b),
    [12, 20, 30, 31],
  );
});
