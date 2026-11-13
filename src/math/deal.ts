import { PLAY } from './constants';
import type { PlayPoint } from './lens';
import type { Pitch } from './types';
import type { Rand } from './rng';

/** A close call: within 1.5 in of flipping. */
export const CLOSE_IN = 1.5;

/**
 * The game deals only pitches whose crossing is within reach of a call. The rest (bounced, wild, far off the plate)
 * are all at least 6.6 in from flipping, and keeping them in frame would need a wider lens.
 */
export const playable = (p: Pitch): boolean => p.mid.z > PLAY.zMin && p.mid.z < PLAY.zMax && Math.abs(p.mid.x) < PLAY.xMax;

/** Every crossing the game can deal: the lens is fitted to keep all of them in frame. */
export function playPoints(today: readonly Pitch[], pool: readonly Pitch[]): PlayPoint[] {
  return [...today, ...pool.filter(playable)].map((p) => ({ x: p.mid.x, z: p.mid.z }));
}

export const listJoin = (a: readonly (string | number)[]): string => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

export function todayLede(today: readonly Pitch[], label: string): string {
  const games = [...new Set(today.map((p) => p.gameNumber))].sort((a, b) => a - b);
  const close = today.filter((p) => Math.abs(p.edgeMarginIn) <= CLOSE_IN).length;

  return `Today's Ten: real pitches from Game${games.length > 1 ? 's' : ''} ${listJoin(games)} of the ${label}, ${close} of them close calls within ${CLOSE_IN} in of the zone, at real speed, from the plate umpire's eye.`;
}

/**
 * "Another ten", dealt the way Today's Ten is: a clear calibrator (6 in or more from the edge) first, then eight close
 * calls within 1.5 in (at least one ABS-challenged; balls and strikes in whatever mix the draw gives, so counting them
 * tells you nothing) and one more from 1.5-4.5 in, the nine in game order. Never repeats Today's Ten.
 */
export function pickPoolTen(pool: readonly Pitch[], today: readonly Pitch[], rand: Rand = Math.random): Pitch[] {
  const todayIds = new Set(today.map((p) => p.id));
  const m = (p: Pitch): number => Math.abs(p.edgeMarginIn);
  const cands = pool.filter((p) => playable(p) && !todayIds.has(p.id));
  const out: Pitch[] = [];
  const take = (list: readonly Pitch[], n: number): void => {
    const from = list.filter((p) => !out.includes(p));

    for (let k = 0; k < n && from.length; k++) out.push(from.splice(Math.floor(rand() * from.length), 1)[0]);
  };
  const close = cands.filter((p) => m(p) <= CLOSE_IN);

  take(close.filter((p) => p.challenge), 1);
  take(close, 7);
  take(cands.filter((p) => m(p) > CLOSE_IN && m(p) <= 4.5), 1);
  const ord = (p: Pitch): number => {
    const [, ab, pn] = p.id.split('-').map(Number);

    return p.gameNumber * 1e6 + ab * 100 + pn;
  };

  out.sort((a, b) => ord(a) - ord(b));
  const cal = cands.filter((p) => m(p) >= 6 && !out.includes(p));

  return [cal[Math.floor(rand() * cal.length)], ...out];
}
