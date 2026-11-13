import type { PitchData } from '../data/source';
import { playPoints } from '../math/deal';
import type { PreparedPitch } from '../math/kinematics';
import { prep } from '../math/kinematics';
import { createLens, type Lens } from '../math/lens';
import type { Game, Pitch } from '../math/types';
import type { CallOrNone, Result } from '../math/words';

export type Phase = 'boot' | 'start' | 'pitch' | 'reveal' | 'replay' | 'card';

/** The loaded dataset and everything derived from it once. */
export interface World {
  data: PitchData;
  games: Map<number, Game>;
  /** Today's Ten, prepared once, so per-pitch caches (stance, framing, path dots) live for the session. */
  today: PreparedPitch[];
  lens: Lens;
}

let current: World | null = null;

export function createWorld(data: PitchData): World {
  return {
    data,
    games: new Map(data.games.map((g) => [g.gamePk, g])),
    today: data.today.map(prep),
    lens: createLens(playPoints(data.today, data.pitches)),
  };
}

export function setWorld(w: World): void {
  current = w;
}

export function world(): World {
  if (!current) throw new Error('The pitch data has not loaded.');

  return current;
}

export function gameOf(p: Pitch): Game {
  return world().games.get(p.gamePk) || { gamePk: p.gamePk, gameNumber: p.gameNumber, away: 'Away', home: 'Home' };
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
