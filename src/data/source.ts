import type { Game, Pitch } from '../math/types';

/** Everything the game deals from. A season dataset plugs in by providing another PitchSource. */
export interface PitchData {
  /** What the pitches are, as the copy names them, e.g. "2026 World Series". */
  readonly label: string;
  readonly games: readonly Game[];
  /** The pool "Another ten" deals from. */
  readonly pitches: readonly Pitch[];
  /** Today's Ten, in play order. */
  readonly today: readonly Pitch[];
}

export interface PitchSource {
  readonly id: string;
  load(): Promise<PitchData>;
}
