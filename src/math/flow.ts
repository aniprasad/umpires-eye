import { CALL_AFTER_CATCH, REPLAY_RATE } from './constants';
import type { PreparedPitch } from './kinematics';
import { clamp } from './util';
import type { Pitch } from './types';
import type { CallOrNone, Result } from './words';

/** The call window opens at release and closes at the catch plus 1.5 s; running out of time counts as a miss. */
export const callWindowEnd = (P: PreparedPitch): number => P.k.toCatch + CALL_AFTER_CATCH;

/** When the reveal starts for a call made s seconds after release: never before the catch has settled. */
export const revealAt = (P: PreparedPitch, s: number): number => Math.max(s + 0.12, P.k.toCatch + 0.3);

/** The share of the call window still left at s, for the indicator's draining line. */
export const clockLeft = (P: PreparedPitch, s: number): number => (s < 0 ? 1 : clamp(1 - s / callWindowEnd(P), 0, 1));

/** How long the 25% replay runs before the reveal comes back. */
export const replayLength = (P: PreparedPitch): number => (P.k.toCatch + 0.36) / REPLAY_RATE + 0.7;

/** The count after the pitch: the final call added, held below a walk or a strikeout. */
export function countAfter(P: Pitch): { balls: number; strikes: number } {
  let balls = P.countBefore.balls;
  let strikes = P.countBefore.strikes;

  if (P.finalCall === 'ball' && balls < 3) balls++;
  else if (P.finalCall === 'strike' && strikes < 2) strikes++;

  return { balls, strikes };
}

export function judged(P: PreparedPitch, call: CallOrNone): Result {
  return { call, truth: P.absTruth, correct: call === P.absTruth, P };
}

const flip = (P: Pitch): CallOrNone => (P.absTruth === 'strike' ? 'ball' : 'strike');

/** The earlier pitches behind a ?state=pitch|reveal URL: right on all but the very close ones (within 1 in). */
export const urlStateResult = (P: PreparedPitch): Result => judged(P, Math.abs(P.edgeMarginIn) < 1 ? flip(P) : P.absTruth);

/** The round behind ?state=card&correct=N: the misses go to the closest pitches. */
export function cardStateResults(set: readonly PreparedPitch[], correct: number): Result[] {
  const order = set.map((_P, k) => k).sort((a, b) => Math.abs(set[a].edgeMarginIn) - Math.abs(set[b].edgeMarginIn));
  const missIdx = new Set(order.slice(0, set.length - correct));

  return set.map((P, k) => judged(P, missIdx.has(k) ? flip(P) : P.absTruth));
}
