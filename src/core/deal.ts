// The round of ten, as the mockup deals it. The app and the data tools share it: the tools prove every shard can deal,
// and the app deals Another ten.
import type { Rand } from './rng.ts';
import { CALIBRATOR_MIN_IN, CLOSE_IN, NEAR_IN } from './rules.ts';
import type { StoredPitch } from './schema.ts';

/** What the dealer knows about a pitch. */
export interface Card {
  id: string;
  /** Played order: a later pitch has a larger seq. */
  seq: number;
  /** Inches from flipping the ABS call, either way. */
  absMarginIn: number;
  challenged: boolean;
}

/** The piles a ten is drawn from. A challenged close call is in both close piles. */
export interface Piles<T extends Card> {
  calibrators: T[];
  closeChallenged: T[];
  close: T[];
  near: T[];
}

/** Sorts cards into piles. Pass only dealable cards: each source decides which of its pitches those are. */
export function pilesOf<T extends Card>(dealable: readonly T[]): Piles<T> {
  const close = dealable.filter((c) => c.absMarginIn <= CLOSE_IN);

  return {
    calibrators: dealable.filter((c) => c.absMarginIn >= CALIBRATOR_MIN_IN),
    closeChallenged: close.filter((c) => c.challenged),
    close,
    near: dealable.filter((c) => c.absMarginIn > CLOSE_IN && c.absMarginIn <= NEAR_IN),
  };
}

/** Why a ten breaks the rules of the round, or nothing if it doesn't. */
export function tenProblems(ten: readonly Card[]): string[] {
  const problems: string[] = [];
  const [first, ...rest] = ten;
  const close = rest.filter((c) => c.absMarginIn <= CLOSE_IN);
  const near = rest.filter((c) => c.absMarginIn > CLOSE_IN && c.absMarginIn <= NEAR_IN);

  if (ten.length !== 10) problems.push(`${ten.length} pitches`);
  if (new Set(ten.map((c) => c.id)).size !== ten.length) problems.push('a pitch repeats');
  if (!first || first.absMarginIn < CALIBRATOR_MIN_IN) problems.push('no calibrator first');
  if (close.length !== 8) problems.push(`${close.length} close calls`);
  if (!close.some((c) => c.challenged)) problems.push('no ABS challenge among the close calls');
  if (near.length !== 1) problems.push(`${near.length} calls between ${CLOSE_IN} and ${NEAR_IN} in`);
  if (rest.some((c, k) => k > 0 && (rest[k - 1]?.seq ?? -Infinity) > c.seq)) problems.push('not in played order');

  return problems;
}

/**
 * The mockup's round of ten: a calibrator 6 in or more from the edge, then eight close calls within 1.5 in (at least one
 * of them ABS-challenged) and one more within 4.5 in, those nine in the order they were played. Balls and strikes come
 * in whatever mix the draw gives, so counting them tells a player nothing. Every draw comes from `rand`, so a seeded
 * rand deals the same ten each time.
 *
 * Returns ten distinct cards that meet those rules, or null when a pile has run short, as one does once the piles have
 * dealt enough tens.
 */
export function dealTen<T extends Card>(piles: Piles<T>, rand: Rand): T[] | null {
  const picked = new Set<T>();
  const out: T[] = [];
  const take = (list: readonly T[], n: number): boolean => {
    const free = list.filter((c) => !picked.has(c));

    for (let k = 0; k < n; k++) {
      const [c] = free.splice(Math.floor(rand() * free.length), 1);

      if (!c) return false;
      picked.add(c);
      out.push(c);
    }

    return true;
  };

  if (!take(piles.closeChallenged, 1) || !take(piles.close, 7) || !take(piles.near, 1)) return null;
  out.sort((a, b) => a.seq - b.seq);

  const calibrators = piles.calibrators.filter((c) => !picked.has(c));
  const first = calibrators[Math.floor(rand() * calibrators.length)];

  if (!first) return null;

  const ten = [first, ...out];
  // Piles built some other way than pilesOf, or two cards with one id, could still break the rules.
  const problems = tenProblems(ten);

  if (problems.length) throw new Error(`These piles dealt a ten that breaks the rules of the round: ${problems.join('; ')}`);

  return ten;
}

/** A season file's row, as a card. */
export interface RowCard extends Card {
  row: StoredPitch;
}

/**
 * Cards for the rows of one shard or month file that may be dealt, in the file's played order. The stored dealable
 * flag decides: nothing here re-derives it from the crossing, the flight time or the release data.
 */
export function dealableCards(rows: readonly StoredPitch[]): RowCard[] {
  return rows.flatMap((row, seq) => (row.dealable ? [{ id: row.id, seq, absMarginIn: Math.abs(row.marginIn), challenged: row.challenge !== null, row }] : []));
}
