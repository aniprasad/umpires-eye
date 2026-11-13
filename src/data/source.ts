// The source contract (docs/M2-DESIGN.md §4.8): what a dataset hands the game. The World Series pool and the season
// both implement it, and the game never reaches past it into a file.
import type { PlayPoint } from '../math/lens';
import type { Pitch } from '../math/types';

export interface PitchSource {
  readonly id: 'season-2026' | 'ws-2026';
  /** What the copy calls the set, e.g. "2026 World Series". */
  readonly label: string;
  /** The crossings the lens must keep in frame. The world fits the lens once, from these. */
  readonly lensPoints: readonly PlayPoint[];

  /** Today's Ten for a local date, or why there isn't one. Rejects with a LoadError. */
  today(dateKey: string, signal?: AbortSignal): Promise<TodayResult>;

  /** The deck for Another ten. The season source loads its first shard on the first call. Rejects with a LoadError. */
  deck(signal?: AbortSignal): Promise<Deck>;

  /** The ump figure with its label and definition, or null if it couldn't be loaded. */
  umpFigure(): Promise<UmpFigure | null>;
}

export type TodayResult =
  | { readonly kind: 'ten'; readonly dateKey: string; readonly pitches: readonly Pitch[] }
  | { readonly kind: 'none'; readonly dateKey: string; readonly reason: 'outside-horizon' | 'unavailable' };

export interface Deck {
  /** Dealable pitches only, in played order, without the daily reserve. */
  readonly pitches: readonly Pitch[];

  /** A deck from a shard not yet used on this page, or null when none is left. */
  next(signal?: AbortSignal): Promise<Deck | null>;
}

export interface UmpFigure {
  /** Percent of calls the umps got right. */
  readonly pct: number;
  /** Whose calls, e.g. "MLB umps". */
  readonly label: string;
  /** Where the figure comes from, or what it measures. */
  readonly definition: string;
  /** True for a rounded, cited figure, written with "≈". */
  readonly approx: boolean;
}

/**
 * - network: no answer, a timeout or a server error, which a retry may fix;
 * - offline: the device says it has no connection;
 * - missing: the file isn't there (a 404);
 * - data: the file is there but unusable: bad JSON, the wrong format or version, or contents that don't add up.
 */
export type LoadErrorKind = 'network' | 'offline' | 'missing' | 'data';

/** Why a source couldn't load. The start screen's states are chosen by its kind. */
export class LoadError extends Error {
  readonly kind: LoadErrorKind;

  constructor(kind: LoadErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}
