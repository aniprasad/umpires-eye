import { EYE, STANCE, STANCE_MAX } from './constants';
import { hash32, rng, type Rand } from './rng';
import { clamp } from './util';
import type { Pitch, Side, Vec3 } from './types';

/** The nominal slot for a batter side: toward the batter, behind the plate. */
export function eyeFor(side: Side): Vec3 {
  const s = side === 'R' ? -1 : 1;

  return { x: s * EYE.x, y: EYE.y, z: EYE.z };
}

const STANCES = new WeakMap<Pitch, Vec3>();

/**
 * This pitch's stance offset (ft), seeded by plate appearance (gamePk-atBat) and by pitch, so the reveal, the replay,
 * the URL states and the tests all see the same eye.
 */
export function stanceOf(P: Pitch): Vec3 {
  const hit = STANCES.get(P);

  if (hit) return hit;
  const pa = rng(hash32('stance|' + P.id.split('-').slice(0, 2).join('-')));
  const ps = rng(hash32('settle|' + P.id));
  const u = (r: Rand): number => 2 * r() - 1;
  const hf = clamp((P.batter.heightFt - 6.1) / 0.45, -1, 1);
  const x = STANCE.paX * u(pa);
  const y = STANCE.paY * u(pa);
  const z = STANCE.follow * hf + (STANCE.paZ - STANCE.follow) * u(pa);
  const st = { x: (x + STANCE.pitch * u(ps)) / 12, y: (y + STANCE.pitch * u(ps)) / 12, z: (z + STANCE.pitch * u(ps)) / 12 };

  STANCES.set(P, st);

  return st;
}

/** The eye for this pitch: the slot plus the stance, with x mirrored toward the batter. */
export function eyeOf(P: Pitch): Vec3 {
  const n = eyeFor(P.batter.side);
  const st = stanceOf(P);
  const s = P.batter.side === 'R' ? -1 : 1;

  return { x: n.x + s * st.x, y: n.y + st.y, z: n.z + st.z };
}

/** The 8 corners of the stance box around the slot. */
export function stanceCorners(side: Side): Vec3[] {
  const n = eyeFor(side);
  const out: Vec3[] = [];

  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) out.push({ x: n.x + a * STANCE_MAX.x, y: n.y + b * STANCE_MAX.y, z: n.z + c * STANCE_MAX.z });
    }
  }

  return out;
}
