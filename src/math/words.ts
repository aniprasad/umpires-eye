import { PLATE_HALF } from './constants';
import type { PreparedPitch } from './kinematics';
import type { Call } from './types';

export type CallOrNone = Call | 'none';

/**
 * The data credit AGENTS.md requires. The copied result ends with it, and vite.config.ts writes it into
 * index.html's footnotes at build time, so this is the only copy.
 */
export const DATA_CREDIT = 'MLB Stats API, © MLB Advanced Media, L.P.; individual, non-commercial use. Not affiliated with MLB.';

/** One finished pitch: your call against the ABS truth. */
export interface Result {
  call: CallOrNone;
  truth: Call;
  correct: boolean;
  P: PreparedPitch;
}

export const cap1 = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

export const lastName = (n: string): string => {
  const p = n.trim().split(/\s+/);

  return p.length > 1 ? p.slice(1).join(' ') : n;
};

export function fmtHeight(h: number): string {
  let ft = Math.floor(h + 1e-6);
  let inch = Math.round((h - ft) * 12);

  if (inch === 12) {
    ft++;
    inch = 0;
  }

  return `${ft}′${inch}″`;
}

export const callWord = (c: CallOrNone): string => (c === 'none' ? 'No call' : cap1(c));

/** The reveal's margin line: which edge it caught, or which way it missed, and by how much. */
export function marginPhrase(P: PreparedPitch): string {
  const m = P.k.judge.marginIn;
  const x = P.k.mid.x;
  const z = P.k.mid.z;
  const Z = P.zone;
  const am = Math.abs(m).toFixed(1);
  const inside = P.batter.side === 'R' ? x < 0 : x > 0;

  if (m >= 0) {
    if (m >= 6) return `In the heart of the zone, ${am}\u00a0in from the nearest edge`;
    const dx = Math.abs(x) - PLATE_HALF;
    const lo = Z.bottom - z;
    const hi = z - Z.top;
    const best = Math.max(dx, lo, hi);
    const edge = best === lo ? 'the bottom of the zone' : best === hi ? 'the top of the zone' : inside ? 'the inside edge' : 'the outside edge';

    return `Caught ${edge} by ${am}\u00a0in`;
  }
  const dirs: string[] = [];

  if (z < Z.bottom) dirs.push('low');
  else if (z > Z.top) dirs.push('high');
  if (Math.abs(x) > PLATE_HALF) dirs.push(inside ? 'inside' : 'away');

  return `${m <= -6 ? 'Clear ball, missed' : 'Missed'} ${dirs.join(' and ')} by ${am}\u00a0in`;
}

/** Where a pitch crossed, in the words a fan would use: low and away, up, inside, middle. */
export function locWord(P: PreparedPitch): string {
  const x = P.k.mid.x;
  const z = P.k.mid.z;
  const Z = P.zone;
  const h = Z.top - Z.bottom;
  const inside = P.batter.side === 'R' ? x < 0 : x > 0;
  const v = z < Z.bottom + h * 0.3 ? 'low' : z > Z.top - h * 0.3 ? 'up' : '';
  const s = Math.abs(x) > 0.42 ? (inside ? 'in' : 'away') : '';

  return v && s ? `${v} and ${s}` : v || (s === 'in' ? 'inside' : s) || 'middle';
}

export function tally<T>(arr: readonly T[]): [T, number][] {
  const m = new Map<T, number>();

  for (const a of arr) m.set(a, (m.get(a) || 0) + 1);

  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** The card's "toughest": the most-missed pitch type, or location when that's the stronger pattern. */
export function toughest(results: readonly (Result | undefined)[]): string {
  const miss = results.filter((r): r is Result => !!r && !r.correct);

  if (!miss.length) return 'Nothing got by you';
  const [type, tn] = tally(miss.map((r) => r.P.pitchType.name))[0];
  const [loc, ln] = tally(miss.map((r) => locWord(r.P)))[0];

  if (ln > tn) return `${cap1(loc)} (${ln} missed)`;

  return tn > 1 ? `${type} (${tn} missed)` : `${type}, ${loc}`;
}

/** The text "Copy result" puts on the clipboard. */
export function resultText(opts: { label: string; roundLabel: string; set: readonly PreparedPitch[]; results: readonly (Result | undefined)[] }): string {
  const { label, roundLabel, set, results } = opts;
  const n = set.length;
  const right = results.filter((r) => r && r.correct).length;
  const ump = set.filter((P) => P.umpCorrect).length;

  return [
    `Umpire's Eye · ${label} · ${roundLabel}`,
    `I called ${right} of ${n} right (${Math.round((right / n) * 100)}%). The real ump: ${ump}/${n}. MLB umps ≈ 94%.`,
    `Toughest: ${toughest(results)}`,
    set.map((_P, k) => (results[k]?.correct ? '✓' : '✗')).join(''),
    `Real pitches: ${DATA_CREDIT}`,
  ].join('\n');
}
