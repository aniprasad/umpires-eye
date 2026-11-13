// The season dataset's file formats, shared by the data tools that write them and the app that reads them. docs/DATA.md
// describes every field ("Format (version 1)").
import { TRAJ_KEYS, type Traj } from './kinematics.ts';

export const FORMAT_VERSION = 1;
export const SHARD_FORMAT = 'umpires-eye.season-shard';
export const MANIFEST_FORMAT = 'umpires-eye.season-manifest';
export const STATS_FORMAT = 'umpires-eye.season-stats';
export const DAILY_FORMAT = 'umpires-eye.season-daily';

// Each table's columns, in the order they're written. Readers find columns by name, so a later version can add or
// reorder fields.
export const GAME_FIELDS = ['gamePk', 'date', 'start', 'gameType', 'away', 'home', 'series', 'seriesGame', 'venue'] as const;
export const NAME_FIELDS = ['id', 'name'] as const;
export const PLAYER_FIELDS = ['id', 'name', 'heightIn'] as const;
export const CHALLENGE_FIELDS = ['by', 'team', 'role', 'overturned'] as const;
export const PITCH_FIELDS = [
  'gamePk',
  'atBat',
  'pitch',
  'inning',
  'top',
  'outs',
  'balls',
  'strikes',
  'awayScore',
  'homeScore',
  'bases',
  'batter',
  'bats',
  'pitcher',
  'throws',
  'umpire',
  'type',
  'mph',
  ...TRAJ_KEYS,
  'extension',
  'zoneTop',
  'zoneBottom',
  'ump',
  'final',
  'abs',
  'marginIn',
  'dealable',
  'challenge',
] as const;

export type PitchField = (typeof PITCH_FIELDS)[number];
export type Family = 'fastball' | 'breaking' | 'offspeed' | 'other';
export const FAMILIES: readonly Family[] = ['fastball', 'breaking', 'offspeed', 'other'];
export type Cell = string | number | null | Cell[];
export type Row = Cell[];
export type Side = 'L' | 'R';
/** S is a strike, B a ball. */
export type CallCode = 'S' | 'B';
/** B is the batter, P the pitcher, C the catcher. */
export type RoleCode = 'B' | 'P' | 'C';

/** Column names for each table, and for the challenge cell inside a pitch row. */
export interface Fields {
  games: readonly string[];
  venues: readonly string[];
  umpires: readonly string[];
  players: readonly string[];
  pitches: readonly string[];
  challenge: readonly string[];
}

/** What every season file starts with. */
export interface FileHead {
  format: string;
  version: number;
  season: number;
  credit: string;
  truthNote: string;
}

/** A shard as written: its head, its place among the shards, and five tables of rows. */
export interface ShardDoc extends FileHead {
  shard: number;
  shards: number;
  fields: Fields;
  /** A pitch type code's name and family. */
  pitchTypes: Record<string, [string, string]>;
  games: unknown[][];
  venues: unknown[][];
  umpires: unknown[][];
  players: unknown[][];
  pitches: unknown[][];
}

/** A shard, as the manifest lists it. */
export interface ShardFileMeta {
  /** Relative to the manifest, e.g. "shards/00.json". */
  file: string;
  pitches: number;
  dealable: number;
  bytes: number;
  sha256: string;
}

/** manifest.json, in the MANIFEST_FORMAT. docs/DATA.md describes each block. */
export interface ManifestDoc extends FileHead {
  source: string;
  coverage: {
    gameTypes: readonly string[];
    /** YYYY-MM-DD, or null when there are no games. */
    firstDate: string | null;
    lastDate: string | null;
    games: number;
    gamesWithVenue: number;
    calledPitchesWithPlateUmpire: number;
    calledPitches: number;
    challenges: number;
  };
  /** Each convention, in words. */
  conventions: Record<string, string>;
  rules: {
    ballRadiusIn: number;
    plateHalfWidthIn: number;
    judgePlaneYFt: number;
    frontOfPlateYFt: number;
    rubberYFt: number;
    dealBox: { zMin: number; zMax: number; xMax: number };
    maxFlightS: number;
    closeIn: number;
    nearIn: number;
    calibratorMinIn: number;
  };
  /** A game type code's name. */
  gameTypes: Record<string, string>;
  /** A team abbreviation's name. */
  teams: Record<string, string>;
  /** A pitch type code's name and family. */
  pitchTypes: Record<string, [string, string]>;
  fields: Fields;
  /** What the shards hold, what the sampler added and at what rates, and the season's dealable pitches in each band. */
  pool: {
    pitches: number;
    dealable: number;
    closeWithinIn: number;
    close: number;
    nearWithinIn: number;
    near: number;
    /** Between the near and calibrator bands: in the pool only when challenged, and never dealt. */
    mid: number;
    calibratorMinIn: number;
    calibrators: number;
    challenged: number;
    challengedDealable: number;
    sampled: { near: number; calibrators: number };
    sampledPerClose: { near: number; calibrator: number };
    seasonDealable: { close: number; near: number; mid: number; clear: number };
  };
  session: { budgetGzipBytes: number; files: readonly string[] };
  shards: ShardFileMeta[];
}

/** How many calls agreed, of how many, and that as a percentage to two decimals (0 when there were none). */
export interface Tally {
  agree: number;
  total: number;
  pct: number;
}

/** A tally of the calls within withinIn inches of the zone's edge. */
export interface BandTally extends Tally {
  withinIn: number;
}

/**
 * stats.json, in the STATS_FORMAT: season totals over every called pitch, not just the pool's. Counts by game type are
 * keyed by its code.
 */
export interface StatsDoc extends FileHead {
  games: { total: number; byType: Record<string, number> };
  calledPitches: { total: number; calledStrikes: number; balls: number; byType: Record<string, number> };
  excluded: { ballInDirt: number; automatic: number; noTracking: number };
  challenges: {
    total: number;
    overturned: number;
    /** Keyed by who challenged: catcher, pitcher or batter. */
    byRole: Record<string, { challenges: number; overturned: number }>;
    absAgreesWithFinalCall: Tally;
  };
  /** The plate umpire's original call against our ABS reconstruction, except afterChallenges, which takes the final call. */
  umpVsAbs: {
    overall: Tally;
    close: BandTally;
    near: BandTally;
    afterChallenges: Tally;
    missed: { strikesCalledBalls: number; ballsCalledStrikes: number };
  };
  umpVsAbsByGameType: Record<string, { overall: Tally; close: BandTally }>;
}

export interface StoredGame {
  gamePk: number;
  /** The official date, YYYY-MM-DD. */
  date: string;
  /** The scheduled start, ISO UTC. */
  start: string;
  gameType: string;
  away: string;
  home: string;
  series: string | null;
  seriesGame: number | null;
  /** An id into the venues table. */
  venue: number | null;
}

export interface StoredPlayer {
  name: string;
  heightIn: number | null;
}

export interface StoredChallenge {
  by: number;
  team: string;
  role: RoleCode;
  overturned: boolean;
}

/** One pitch row, everything about the moment before the pitch. */
export interface StoredPitch {
  /** gamePk-atBat-pitch. */
  id: string;
  gamePk: number;
  atBat: number;
  pitch: number;
  inning: number;
  top: boolean;
  outs: number;
  balls: number;
  strikes: number;
  awayScore: number;
  homeScore: number;
  /** Occupied bases: 1 is first, 2 second, 4 third. */
  bases: number;
  batter: number;
  bats: Side;
  pitcher: number;
  throws: Side;
  /** The plate umpire for this pitch, an id into the umpires table. */
  umpire: number | null;
  type: string | null;
  mph: number | null;
  traj: Traj;
  extension: number | null;
  zoneTop: number;
  zoneBottom: number;
  ump: CallCode;
  final: CallCode;
  abs: CallCode;
  marginIn: number;
  dealable: boolean;
  challenge: StoredChallenge | null;
}
