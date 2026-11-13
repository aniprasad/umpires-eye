import { inDealBox } from '../core/abs.ts';
import { dealTen, pilesOf, type Card } from '../core/deal.ts';
import { quickEnough } from '../core/kinematics.ts';
import type { Rand } from '../core/rng.ts';
import { CLOSE_IN } from '../core/rules.ts';
import type { PlayPoint } from './lens';
import type { Pitch } from './types';

/**
 * The World Series pool has no stored dealable flag, so the game deals the pitches it can show as they happened: the
 * mid-plate crossing is in the deal box, and the pitch is quick enough to stay in frame (every one of the 742 is). The
 * rest (bounced, wild, far off the plate) are all at least 6.6 in from flipping, and keeping them in frame would need a
 * wider lens.
 */
export const playable = (p: Pitch): boolean => inDealBox(p.mid) && quickEnough(p.traj, p.extension);

/** Every crossing the game can deal: the lens is fitted to keep all of them in frame. */
export function playPoints(today: readonly Pitch[], pool: readonly Pitch[]): PlayPoint[] {
  return [...today, ...pool.filter(playable)].map((p) => ({ x: p.mid.x, z: p.mid.z }));
}

export const listJoin = (a: readonly (string | number)[]): string => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** The Series games the pitches come from, in order: the start lede and the card name them. */
export const seriesGames = (pitches: readonly Pitch[]): number[] =>
  [...new Set(pitches.flatMap((p) => (p.game.seriesGame === null ? [] : [p.game.seriesGame])))].sort((a, b) => a - b);

const closeCalls = (today: readonly Pitch[]): number => today.filter((p) => Math.abs(p.edgeMarginIn) <= CLOSE_IN).length;
const lede = (title: string, from: string, today: readonly Pitch[]): string =>
  `${title}: real pitches from ${from}, ${closeCalls(today)} of them close calls within ${CLOSE_IN} in of the zone, at real speed, from the plate umpire's eye.`;

export function todayLede(today: readonly Pitch[], label: string): string {
  const games = seriesGames(today);

  return lede("Today's Ten", `Game${games.length > 1 ? 's' : ''} ${listJoin(games)} of the ${label}`, today);
}

/** A season ten comes from games all over the season, so its lede names none of them. It names its date instead. */
export const seasonLede = (today: readonly Pitch[], label: string, date: string): string => lede(`Today's Ten for ${date}`, `the ${label}`, today);

/** The start screen for a date without a Ten (§2.7): Another ten is what there is to play. */
export const noTodayLede = (date: string, label: string): string => `There's no Today's Ten for ${date}. Another ten deals fresh pitches from the ${label}.`;

interface PitchCard extends Card {
  p: Pitch;
}

const cardOf = (p: Pitch): PitchCard => ({ id: p.id, seq: p.order, absMarginIn: Math.abs(p.edgeMarginIn), challenged: p.challenge !== null, p });

/**
 * A ten dealt by core's dealer the way Today's Ten is (see dealTen), from a source's deck: its dealable pitches in played
 * order. It never deals a pitch whose ID is in `leaveOut`, and gives null when what's left can't deal a full ten.
 */
export function dealFrom(deck: readonly Pitch[], leaveOut: ReadonlySet<string>, rand: Rand): Pitch[] | null {
  const ten = dealTen(pilesOf(deck.filter((p) => !leaveOut.has(p.id)).map(cardOf)), rand);

  return ten ? ten.map((c) => c.p) : null;
}

/** "Another ten" as M1 dealt it, leaving out only the pitches it's given (Today's Ten). Throws when it can't deal a ten. */
export function pickPoolTen(deck: readonly Pitch[], leaveOut: readonly Pitch[], rand: Rand): Pitch[] {
  const ten = dealFrom(deck, new Set(leaveOut.map((p) => p.id)), rand);

  if (!ten) throw new Error("Another ten couldn't be dealt: the pool has run short of close calls, near calls or calibrators.");

  return ten;
}
