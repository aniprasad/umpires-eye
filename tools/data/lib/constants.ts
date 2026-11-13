// Units are feet, seconds and mph unless a name says otherwise. Coordinates are the catcher's view: +x toward first
// base, y toward the pitcher from the back tip of the plate, z up from the ground.

export const SEASON = 2026;
export const GAME_TYPES = ['R', 'F', 'D', 'L', 'W'] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_NAMES: Record<GameType, string> = {
  R: 'Regular season',
  F: 'Wild Card Series',
  D: 'Division Series',
  L: 'League Championship Series',
  W: 'World Series',
};

export const BALL_RADIUS_IN = 1.45;
export const BALL_R = BALL_RADIUS_IN / 12;
export const PLATE_HALF_IN = 8.5;
export const PLATE_HALF = PLATE_HALF_IN / 12;
export const PLATE_FRONT_Y = 17 / 12;
export const MID_Y = 8.5 / 12;
export const RUBBER_Y = 60.5;

// The app's lens is fitted to every crossing inside this box, so dealing anything outside it would widen the lens.
export const DEAL_BOX = { zMin: 0.9, zMax: 4.5, xMax: 1.5 } as const;

// From release to the front of the plate. An eephus or a position player's lob arcs high and slow enough to leave the
// app's frame on the way in, so only pitches this quick are dealt.
export const MAX_FLIGHT_S = 0.6;

export const CLOSE_IN = 1.5;
export const NEAR_IN = 4.5;
export const CALIBRATOR_MIN_IN = 6;

export const SESSION_BUDGET_GZIP = 300_000;

export const CREDIT =
  'MLB Stats API, \u00a9 MLB Advanced Media, L.P.; individual, non-commercial use. Not affiliated with MLB.';
export const TRUTH_NOTE =
  "abs and marginIn are our reconstruction of the 2026 ABS call from the feed's tracking, not MLB's official ABS output.";
