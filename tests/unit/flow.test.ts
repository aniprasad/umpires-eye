import { describe, expect, it } from 'vitest';
import { CALL_AFTER_CATCH } from '../../src/math/constants';
import { callWindowEnd, cardStateResults, clockLeft, countAfter, revealAt, urlStateResult } from '../../src/math/flow';
import { prep } from '../../src/math/kinematics';
import { synthPitch } from './fixtures';

const P = prep(synthPitch());

describe('the call window', () => {
  it('stays open until 1.5 s after the catch', () => {
    expect(CALL_AFTER_CATCH).toBe(1.5);
    expect(callWindowEnd(P)).toBeCloseTo(P.k.toCatch + 1.5, 12);
  });

  it('drains the indicator line from release to the end of the window', () => {
    expect(clockLeft(P, -0.5)).toBe(1);
    expect(clockLeft(P, callWindowEnd(P) / 2)).toBeCloseTo(0.5, 12);
    expect(clockLeft(P, callWindowEnd(P) + 1)).toBe(0);
  });

  it('reveals once the catch has settled, or just after a late call', () => {
    expect(revealAt(P, 0.1)).toBeCloseTo(P.k.toCatch + 0.3, 12);
    expect(revealAt(P, P.k.toCatch + 1)).toBeCloseTo(P.k.toCatch + 1.12, 12);
  });
});

describe('the count after the pitch', () => {
  it('adds the final call but never shows a fourth ball or a third strike', () => {
    expect(countAfter(synthPitch({ finalCall: 'ball', countBefore: { balls: 1, strikes: 2 } }))).toEqual({ balls: 2, strikes: 2 });
    expect(countAfter(synthPitch({ finalCall: 'ball', countBefore: { balls: 3, strikes: 0 } }))).toEqual({ balls: 3, strikes: 0 });
    expect(countAfter(synthPitch({ finalCall: 'strike', countBefore: { balls: 0, strikes: 2 } }))).toEqual({ balls: 0, strikes: 2 });
  });
});

describe('URL states', () => {
  const margins = [9.6, -0.4, 0.8, -2.1, 5, -0.2, 3.3, -7, 1.4, 0.05];
  const set = margins.map((m, k) => prep(synthPitch({ id: `1-${k}-1`, edgeMarginIn: m, absTruth: m >= 0 ? 'strike' : 'ball' })));

  it('?state=card&correct=N misses exactly the closest pitches', () => {
    const res = cardStateResults(set, 7);
    const missed = res.filter((r) => !r.correct).map((r) => r.P.edgeMarginIn);

    expect(res.filter((r) => r.correct)).toHaveLength(7);
    expect(missed.sort((a, b) => a - b)).toEqual([-0.4, -0.2, 0.05]);
  });

  it('earlier pitches behind ?state=pitch|reveal are wrong only within 1 in of the edge', () => {
    expect(set.map((p) => urlStateResult(p).correct)).toEqual(margins.map((m) => Math.abs(m) >= 1));
  });
});
