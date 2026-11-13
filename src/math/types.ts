// Pitch data as the app consumes it. Units are PITCHf/x feet, seconds and mph, seen from the catcher:
// +x is the catcher's right (1B side), y points toward the pitcher with y = 0 at the back tip of the plate, z is up.

import type { Traj } from '../core/kinematics.ts';

export type { Traj, Vec3 } from '../core/kinematics.ts';

export type Side = 'L' | 'R';
export type Call = 'ball' | 'strike';

export interface Challenge {
  by: string;
  byId: number;
  byTeam: string;
  byRole: string;
  isOverturned: boolean;
}

export interface Game {
  gamePk: number;
  gameNumber: number;
  away: string;
  home: string;
  date?: string;
  awayName?: string;
  homeName?: string;
  venue?: string;
  plateUmpire?: string;
}

export interface Pitch {
  id: string;
  gamePk: number;
  gameNumber: number;
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
