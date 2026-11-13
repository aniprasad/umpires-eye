import type { Cam } from './geometry';

/**
 * One lens for the whole scene, focused on the mound: blur sigma (px) = F × aperture × |1/depth − 1/focus|.
 * At 1440x900 the batter's parts 3-6 ft out land near 20-10 px and the catcher far more. The pitcher sits in the
 * focal plane, and the ball is never blurred because the eye tracks it.
 */
export const DOF = { ap: 0.077, focus: 60 } as const;

export const dofBlur = (cam: Cam, depth: number): number => cam.F * DOF.ap * Math.abs(1 / Math.max(depth, 0.3) - 1 / DOF.focus);
