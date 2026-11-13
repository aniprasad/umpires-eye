// Today's Ten as a schedule (docs/M2-DESIGN.md §2): the month files that hold it, and the rules that the data tools
// writing them and the app reading them must agree on.
import { unitHash } from './rng.ts';
import { SEED } from './rules.ts';
import type { ShardDoc } from './schema.ts';

/** The share of the pool held back for Today's Ten. Another ten never deals from it. */
export const DAILY_RESERVE = 0.25;

/**
 * Whether a pitch is held back for Today's Ten. The answer rests on the ID alone, so the tools and the app agree on it,
 * and it survives a rebuild.
 */
export const isDailyReserve = (id: string): boolean => unitHash(`${SEED}|daily|${id}`) < DAILY_RESERVE;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The local calendar date, YYYY-MM-DD, so Today's Ten changes at the player's own midnight rather than at UTC's. */
export const dateKeyOf = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** The month file a date reads, YYYY-MM: 2026-11-30 reads 2026-11, and 2026-12-01 reads 2026-12. */
export const monthOf = (dateKey: string): string => dateKey.slice(0, 7);

/** One date's ten IDs, in play order with the calibrator first. Only an available day has rows in its file. */
export type DailyDay =
  | { ids: string[]; available: true }
  // A served day where a pitch has left the pool or stopped being dealable. It keeps its IDs, so none is scheduled again.
  | { ids: string[]; available: false; missing: string[] };

/**
 * daily/YYYY-MM.json, in the DAILY_FORMAT. It has a shard's head and tables, trimmed to the rows its available days
 * use, so one decoder reads both.
 */
export interface DailyDoc extends Omit<ShardDoc, 'shard' | 'shards'> {
  /** YYYY-MM. */
  month: string;
  /** The build id of the shards its rows came from. */
  build: string;
  /** Each scheduled date in the month, YYYY-MM-DD. */
  days: Record<string, DailyDay>;
}

/** A month file, as the manifest lists it. */
export interface DailyFileMeta {
  /** YYYY-MM. */
  month: string;
  /** Relative to the manifest, e.g. "daily/2026-11.json". */
  file: string;
  bytes: number;
  sha256: string;
}

/** The manifest's daily block. data:daily alone writes it, and data:build keeps it as it is. */
export interface ManifestDaily {
  /** The horizon: the first and last dates with a scheduled ten, YYYY-MM-DD. */
  first: string;
  last: string;
  /** The last date that may have been served anywhere. That day's ten and every earlier one never change. */
  servedThrough: string;
  /** The reserve the schedule draws from: its share of the pool, and the dealable pitches it held for this schedule. */
  reserve: { share: number; pitches: number };
  files: DailyFileMeta[];
}
