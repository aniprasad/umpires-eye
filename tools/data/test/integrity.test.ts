import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePitches, type ShardDoc, type StoredPitch } from '../lib/decode.ts';
import { CHALLENGE_FIELDS, PITCH_FIELDS, pitchRow, quantize, rowsJson } from '../lib/format.ts';
import { findingId, judgeFindings, pitchProblems, type ShardIndex } from '../lib/integrity.ts';
import { judged } from './fixtures.ts';

test('only pinned findings pass, and a pin that matches nothing is reported as stale', () => {
  const verdict = judgeFindings(
    {
      impossibleCounts: ['824212-42-5: 0-3 before the pitch', '824212-42-9: 2-3 before the pitch'],
      countMismatches: ['900001-3-2: 1-0 + B -> 1-1'],
      runnersMismatches: ['900001-4: rebuilt 1B, feed empty'],
    },
    { impossibleCounts: ['824212-42-5', '824212-42-9'], challengeMismatches: ['825000-30-3'] },
  );

  assert.deepEqual(verdict.failures, ['countMismatches: 900001-3-2: 1-0 + B -> 1-1', 'runnersMismatches: 900001-4: rebuilt 1B, feed empty']);
  assert.equal(verdict.allowed.length, 2);
  assert.deepEqual(verdict.stale, ['challengeMismatches: 825000-30-3']);
  // A pin is for one kind of finding only.
  assert.equal(judgeFindings({ countMismatches: ['824212-42-5: 0-3 + B -> 1-3'] }).failures.length, 1);
  assert.deepEqual([findingId('900001-3-2 (B, no tracking)'), findingId('900001-4: x')], ['900001-3-2', '900001-4']);
});

const index: ShardIndex = {
  games: new Map([[900001, 0]]),
  heights: new Map([
    [11, 74],
    [20, 75],
    [30, 72],
  ]),
  types: new Set(['FF']),
  umpires: new Map([[70, 'Plate Ump']]),
};

// A dealable ball the catcher challenged, upheld, as a shard stores it.
function stored(over: Partial<StoredPitch> = {}): StoredPitch {
  const j = judged({ seq: 3, marginIn: -1.2, challenged: true });
  const doc = JSON.parse(
    rowsJson({ fields: { pitches: PITCH_FIELDS, challenge: CHALLENGE_FIELDS } }, [['pitches', [pitchRow(j, quantize(j), true, () => 'HOM')]]]),
  ) as ShardDoc;
  const [p] = decodePitches(doc);

  assert.ok(p);

  return { ...p, ...over };
}

test('pitchProblems wants a batter height, a pitch type and a known plate umpire on every dealable pitch', () => {
  const noHeight = { ...index, heights: new Map([...index.heights, [11, null]]) };

  assert.deepEqual(pitchProblems(stored(), index), []);
  assert.deepEqual(pitchProblems(stored(), noHeight), ['dealable without a batter height']);
  assert.deepEqual(pitchProblems(stored({ dealable: false }), noHeight), []);
  assert.deepEqual(pitchProblems(stored({ type: null }), index), ['dealable without a pitch type']);
  assert.deepEqual(pitchProblems(stored({ umpire: 71 }), index), ['plate umpire 71 missing from the umpires table']);
  assert.deepEqual(pitchProblems(stored({ umpire: null }), index), []);
});

test('pitchProblems fails a challenge the reconstruction calls the other way, unless it is pinned', () => {
  assert.deepEqual(pitchProblems(stored({ abs: 'S' }), index), ['the ABS reconstruction differs from the final call after a challenge']);
  assert.deepEqual(pitchProblems(stored({ abs: 'S', id: '825000-30-3' }), index), []);
});
