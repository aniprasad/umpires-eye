// Pitch data as the app consumes it. Units are PITCHf/x feet, seconds and mph, seen from the catcher:
// +x is the catcher's right (1B side), y points toward the pitcher with y = 0 at the back tip of the plate, z is up.

import type { Traj } from '../core/kinematics.ts';

export type Side = 'L' | 'R';
export type Call = 'ball' | 'strike';

export interface Challenge {
  by: string;
  byId: number;
  byTeam: string;
  byRole: string;
  isOverturned: boolean;
}

/** Per game. The plate umpire is on each Pitch instead, since umpires sometimes change mid-game. */
export interface GameMeta {
  readonly gamePk: number;
  /** The official date, YYYY-MM-DD. */
  readonly date: string;
  readonly away: string;
  readonly home: string;
  /** How the copy names the game: "2026 World Series · Game 5" in the postseason. */
  readonly label: string;
  /** The game's number in its postseason series, or null in the regular season. */
  readonly seriesGame: number | null;
  readonly venue: string | null;
}

export interface Pitch {
  id: string;
  gamePk: number;
  /** Shared by every pitch of the game. */
  game: GameMeta;
  /** Sorts pitches into played order. It only compares pitches from the same file: a shard, a month file or the pool. */
  order: number;
  /** The plate umpire for this pitch, or null where the play log leaves it unknown. */
  plateUmpire: string | null;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  countBefore: { balls: number; strikes: number };
  score: { away: number; home: number };
  runnersOn: string[];
  batter: { id: number; name: string; side: Side; heightFt: number };
  pitcher: { id: number; name: string; hand: Side };
  pitchType: { code: string; name: string; family: string };
  startSpeed: number;
  extension: number;
  flightTime: number;
  traj: Traj;
  release: { x: number; y: number; z: number; t: number };
  mid: { x: number; z: number; t: number };
  zone: { top: number; bottom: number };
  absTruth: Call;
  edgeMarginIn: number;
  umpCall: Call;
  finalCall: Call;
  umpCorrect: boolean;
  challenge: Challenge | null;
}
