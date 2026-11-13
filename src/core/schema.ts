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

/** A shard as written: its head, its place among the shards, and five tables of rows. */
export interface ShardDoc {
  format: string;
  version: number;
  season: number;
  shard: number;
  shards: number;
  credit: string;
  truthNote: string;
  fields: Fields;
  /** A pitch type code's name and family. */
  pitchTypes: Record<string, [string, string]>;
  games: unknown[][];
  venues: unknown[][];
  umpires: unknown[][];
  players: unknown[][];
  pitches: unknown[][];
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
