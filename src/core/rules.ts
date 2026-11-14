// The rules the game and the data tools share. Feet, seconds and mph unless a name says otherwise. Coordinates are the
// catcher's view: +x toward first base, y toward the pitcher from the back tip of the plate, z up from the ground.

export const SEASON = 2026;
/** Every seed in the dataset starts with this, so a draw is the same in every build and in the app. */
export const SEED = 'umpires-eye-2026';

export const BALL_RADIUS_IN = 1.45;
export const BALL_R = BALL_RADIUS_IN / 12;
export const PLATE_HALF_IN = 8.5;
export const PLATE_HALF = PLATE_HALF_IN / 12;
export const PLATE_FRONT_Y = 17 / 12;
/** The ABS plane: the zone is judged as the ball passes the middle of the plate. */
export const MID_Y = 8.5 / 12;
export const RUBBER_Y = 60.5;

/** The mid-plate crossings the game deals. The lens keeps every one in frame, so dealing outside it would widen the lens. */
export const DEAL_BOX = { zMin: 0.9, zMax: 4.5, xMax: 1.5 } as const;

/**
 * From release to the front of the plate. An eephus or a position player's lob arcs high and slow enough to leave the
 * app's frame on the way in, so only pitches this quick are dealt.
 */
export const MAX_FLIGHT_S = 0.6;

/** A close call is within this many inches of flipping. */
export const CLOSE_IN = 1.5;
export const NEAR_IN = 4.5;
/** The round's first pitch is a clear call, at least this far from flipping. */
export const CALIBRATOR_MIN_IN = 6;

/**
 * The data credit, and its only copy. Every data file carries it, the copied result ends with it, and vite.config.ts
 * writes it into index.html's footnotes at build time.
 */
export const CREDIT = 'MLB Stats API, \u00a9 MLB Advanced Media, L.P.; individual, non-commercial use. Not affiliated with MLB.';
export const TRUTH_NOTE =
  "abs and marginIn are our reconstruction of the 2026 ABS call from the feed's tracking, not MLB's official ABS output.";
