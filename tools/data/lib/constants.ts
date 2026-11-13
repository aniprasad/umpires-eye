// Units are feet, seconds and mph unless a name says otherwise. Coordinates are the catcher's view: +x toward first
// base, y toward the pitcher from the back tip of the plate, z up from the ground. The rules the app shares are in
// src/core/rules.ts.

export {
  BALL_R,
  BALL_RADIUS_IN,
  CALIBRATOR_MIN_IN,
  CLOSE_IN,
  CREDIT,
  DEAL_BOX,
  MAX_FLIGHT_S,
  MID_Y,
  NEAR_IN,
  PLATE_FRONT_Y,
  PLATE_HALF,
  PLATE_HALF_IN,
  RUBBER_Y,
  SEASON,
  SEED,
  TRUTH_NOTE,
} from '../../../src/core/rules.ts';

export const GAME_TYPES = ['R', 'F', 'D', 'L', 'W'] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_NAMES: Record<GameType, string> = {
  R: 'Regular season',
  F: 'Wild Card Series',
  D: 'Division Series',
  L: 'League Championship Series',
  W: 'World Series',
};

export const SESSION_BUDGET_GZIP = 300_000;
