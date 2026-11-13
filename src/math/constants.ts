// Field geometry, the ump's slot and the game's timing. Feet and seconds unless the name says otherwise.

export { BALL_R, DEAL_BOX as PLAY, MID_Y, PLATE_FRONT_Y as PLATE_FRONT, PLATE_HALF, RUBBER_Y } from '../core/rules.ts';
export const MOUND_H = 10 / 12;
export const MOUND_C = { x: 0, y: 59 } as const;
export const MOUND_R = 9;
/** Where the mitt meets the ball. */
export const CATCH_Y = -1.5;

/** The ump's eye in the slot; the x sign follows the batter. */
export const EYE = { x: 0.62, y: -3.7, z: 4.15 } as const;

/**
 * The ump re-sets every plate appearance (eye height loosely following the batter's) and re-settles a little every
 * pitch, so he can't learn where the zone sits on the glass. Inches, uniform within these bounds: x toward the
 * batter, y toward the mound, z up. The lens is fitted to the corners of this box; only the eye moves between pitches.
 */
export const STANCE = { paX: 2, paY: 3, paZ: 2, follow: 0.75, pitch: 0.75 } as const;
export const STANCE_MAX = {
  x: (STANCE.paX + STANCE.pitch) / 12,
  y: (STANCE.paY + STANCE.pitch) / 12,
  z: (STANCE.paZ + STANCE.pitch) / 12,
} as const;

/** The camera yaw aims at (0, LOOK_Y). */
export const LOOK_Y = 30;
/** Air kept around every crossing ball inside the frame. */
export const CROSS_PAD = 0.06;
/** Sky kept above the pitcher's cap, in tan units. */
export const PITCHER_ROOM = 0.05;
/** Desktop: the bottom-corner controls and the indicator column, px. */
export const HUD = { side: 24 + 244 + 12 } as const;

export const WINDUP = 1.15;
export const BEAT = 0.9;
export const FIRST_BEAT = 1.25;
/** A real ump calls it about a second after the pop. */
export const CALL_AFTER_CATCH = 1.5;
/** The glove reacts only in the last 50 ms (ease-in), so it never leads the ball. */
export const MITT_MOVE = 0.05;
/** The catcher's target is held low and still until the ball is on him. */
export const MITT_SETUP_Z = 1.85;
/**
 * Framing, after the catch only: borderline pitches (strike or ball, within `band` in of the ABS edge) are, more
 * often than not, eased toward the zone by 1-4 in over 150-250 ms once the pop is absorbed, then held.
 */
export const FRAME = { band: 3.5, p: 0.65, minIn: 1, maxIn: 4, t0: 0.03, durMin: 0.15, durMax: 0.25 } as const;
/** Speed trail length. */
export const TRAIL = 0.01;
export const REPLAY_RATE = 0.25;
/** Near clipping plane, ft in front of the eye. */
export const NEAR = 0.2;
