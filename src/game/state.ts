import type { PitchSource } from '../data/source';
import type { PreparedPitch } from '../math/kinematics';
import { prep } from '../math/kinematics';
import { createLens, type Lens } from '../math/lens';
import type { Pitch } from '../math/types';
import type { CallOrNone, Result } from '../math/words';
import { anotherTen, type AnotherTen } from './another';

export type Phase = 'boot' | 'start' | 'pitch' | 'reveal' | 'replay' | 'card';

/** The loaded dataset and everything derived from it once. */
export interface World {
  source: PitchSource;
  /** Today's Ten, prepared once, so per-pitch caches (stance, framing, path dots) live for the session. */
  today: PreparedPitch[];
  /** Fitted once, to the source's lens points, so it never shifts with what's loaded. */
  lens: Lens;
  /** Deals Another ten for this page, asking the source for its deck when it's first wanted. */
  another: AnotherTen;
}

let current: World | null = null;

export function createWorld(source: PitchSource, today: readonly Pitch[]): World {
  return {
    source,
    today: today.map(prep),
    lens: createLens(source.lensPoints),
    another: anotherTen(source, today),
  };
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
