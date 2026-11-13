// Today's Ten as a schedule (docs/M2-DESIGN.md §2): the month files that hold it, and the rules that the data tools
// writing them and the app reading them must agree on.
import type { Card } from './deal.ts';
import { unitHash } from './rng.ts';
import { CLOSE_IN, SEED } from './rules.ts';
import type { Family, ShardDoc, Side } from './schema.ts';

/** The share of the pool held back for Today's Ten. Another ten never deals from it. */
export const DAILY_RESERVE = 0.25;

/**
 * Whether a pitch is held back for Today's Ten. The answer rests on the ID alone, so the tools and the app agree on it,
 * and it survives a rebuild.
 */
export const isDailyReserve = (id: string): boolean => unitHash(`${SEED}|daily|${id}`) < DAILY_RESERVE;

/** What Today's Ten's variety rules read about a pitch, besides what the dealer knows. */
export interface VarietyCard extends Card {
  gamePk: number;
  bats: Side;
  family: Family;
  balls: number;
  strikes: number;
}

/**
 * Why a ten breaks Today's Ten's variety rules (docs/M2-DESIGN.md §2.4), or nothing if it doesn't. Each problem starts
 * with its rule's name. The calibrator counts toward spreading games and batter sides, but it's an easy call by design,
 * so the pitch families and the two-strike or three-ball count are looked for among the nine. Only the schedule applies
 * these rules: Another ten keeps the mockup's.
 */
export function varietyProblems(ten: readonly VarietyCard[]): string[] {
  const problems: string[] = [];
  const nine = ten.slice(1);
  const close = nine.filter((c) => c.absMarginIn <= CLOSE_IN);
  const lefties = ten.filter((c) => c.bats === 'L').length;
  const righties = ten.length - lefties;
  const families = new Set(nine.map((c) => c.family));
  const challenged = close.filter((c) => c.challenged).length;

  if (new Set(ten.map((c) => c.gamePk)).size < ten.length) problems.push('one pitch per game: two come from one game');
  if (lefties < 3 || righties < 3) problems.push(`batter sides: ${lefties} left-handed and ${righties} right-handed`);
  if (families.size < 2) problems.push(`pitch families: only ${[...families].join(', ') || 'none'} among the nine`);
  else if (close.length && close.every((c) => c.family === 'fastball')) problems.push('pitch families: every close call is a fastball');
  if (!nine.some((c) => c.strikes === 2 || c.balls === 3)) problems.push('two strikes or three balls: none among the nine');
  if (challenged > 3) problems.push(`ABS challenges: ${challenged} of the close calls`);

  return problems;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The local calendar date, YYYY-MM-DD, so Today's Ten changes at the player's own midnight rather than at UTC's. */
export const dateKeyOf = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** The month file a date reads, YYYY-MM: 2026-11-30 reads 2026-11, and 2026-12-01 reads 2026-12. */
export const monthOf = (dateKey: string): string => dateKey.slice(0, 7);

/** One date's ten IDs, in play order with the calibrator first. Only an available day has rows in its file. */
export type DailyDay =
  | { ids: readonly string[]; available: true }
  // A served day where a pitch has left the pool or stopped being dealable. It keeps its IDs, so none is scheduled again.
  | { ids: readonly string[]; available: false; missing: readonly string[] };

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
  /**
   * The reserve the schedule draws from. `share` is DAILY_RESERVE, the rule's cut-off. `pitches` counts the dealable
   * pool pitches whose IDs are reserved, on the shards whose build id the month files carry: data:daily counts it on
   * every run, and data:validate recounts it, so a rebuild that changes the pool fails validation until data:daily
   * runs again.
   */
  reserve: { share: number; pitches: number };
  files: DailyFileMeta[];
}
