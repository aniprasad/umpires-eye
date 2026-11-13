import type { PitchSource, TodayResult } from '../data/source';
import type { PreparedPitch } from '../math/kinematics';
import { prep } from '../math/kinematics';
import { createLens, type Lens } from '../math/lens';
import type { CallOrNone, Result } from '../math/words';
import { anotherTen, type AnotherTen } from './another';

export type Phase = 'boot' | 'start' | 'pitch' | 'reveal' | 'replay' | 'card';

/** The loaded dataset and everything derived from it once. */
export interface World {
  source: PitchSource;
  /** The date whose Today's Ten the start screen offers, as YYYY-MM-DD. */
  dateKey: string;
  /**
   * Today's Ten, prepared once, so per-pitch caches (stance, framing, path dots) live for the session. Empty when the date
   * has none.
   */
  today: PreparedPitch[];
  /** Fitted once, to the source's lens points, so it never shifts with what's loaded. */
  lens: Lens;
  /** Deals Another ten for this page, asking the source for its deck when it's first wanted. */
  another: AnotherTen;
}

let current: World | null = null;

export function createWorld(source: PitchSource, today: TodayResult): World {
  const pitches = today.kind === 'ten' ? today.pitches : [];

  return {
    source,
    dateKey: today.dateKey,
    today: pitches.map(prep),
    lens: createLens(source.lensPoints),
    // The season's decks hold none of the daily reserve, so a later date's Ten is left out too.
    another: anotherTen(source, pitches),
  };
}

/** Puts a date's Today's Ten, or its lack of one, in place of the World's. */
export function setToday(w: World, today: TodayResult): void {
  w.dateKey = today.dateKey;
  w.today = today.kind === 'ten' ? today.pitches.map(prep) : [];
}

export function setWorld(w: World): void {
  current = w;
}

export function world(): World {
  if (!current) throw new Error('The pitch data has not loaded.');

  return current;
}

/** The round in play. Times are performance.now() milliseconds; s is seconds since release. */
export const G = {
  phase: 'boot' as Phase,
  set: [] as PreparedPitch[],
  mode: 'today' as 'today' | 'pool',
  i: 0,
  results: [] as (Result | undefined)[],
  t0: 0,
  trel: 0,
  /** A URL state's frozen scene time, or null when the clock runs. */
  frozenS: null as number | null,
  call: null as CallOrNone | null,
  callS: null as number | null,
  revealAt: null as number | null,
  revealT0: 0,
  replayT0: 0,
  tBody: 0,
  tAhead: 0,
  repitch: false,
};

export const curP = (): PreparedPitch => G.set[G.i];
