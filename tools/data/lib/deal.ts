import { CALIBRATOR_MIN_IN, CLOSE_IN, NEAR_IN } from './constants.ts';

export interface Card {
  id: string;
  seq: number;
  absMarginIn: number;
  challenged: boolean;
}

export interface Deck<T extends Card> {
  calibrators: T[];
  closeChallenged: T[];
  close: T[];
  near: T[];
}

export function deckOf<T extends Card>(dealable: readonly T[]): Deck<T> {
  const close = dealable.filter((c) => c.absMarginIn <= CLOSE_IN);

  return {
    calibrators: dealable.filter((c) => c.absMarginIn >= CALIBRATOR_MIN_IN),
    closeChallenged: close.filter((c) => c.challenged),
    close,
    near: dealable.filter((c) => c.absMarginIn > CLOSE_IN && c.absMarginIn <= NEAR_IN),
  };
}

// The mockup's round of ten: a calibrator 6 in or more from the edge, then eight close calls within 1.5 in (at least
// one of them ABS-challenged) and one more within 4.5 in, those nine in the order they were played.
export function dealTen<T extends Card>(deck: Deck<T>, rand: () => number): T[] | null {
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

  if (!take(deck.closeChallenged, 1) || !take(deck.close, 7) || !take(deck.near, 1)) return null;
  out.sort((a, b) => a.seq - b.seq);

  const calibrators = deck.calibrators.filter((c) => !picked.has(c));
  const first = calibrators[Math.floor(rand() * calibrators.length)];

  return first ? [first, ...out] : null;
}

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
