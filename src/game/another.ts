// Another ten over a page session (docs/M2-DESIGN.md §3): no pitch is dealt twice on a page. When a deck can't deal
// another ten, the source's next deck takes over; once none is left, the page starts over, still without Today's Ten.
import { mulberry32 } from '../core/rng.ts';
import type { Deck, PitchSource } from '../data/source';
import { dealFrom } from '../math/deal';
import type { Pitch } from '../math/types';

export interface AnotherTen {
  /** Loads the deck the next ten comes from, without dealing, so a press can deal at once. Rejects as deck() does. */
  ready(): Promise<void>;
  /** The next ten. Rejects with the source's LoadError, or when even a fresh start can't deal a full ten. */
  deal(): Promise<Pitch[]>;
}

/**
 * Deals Another ten from a source's decks for one page. Each deal is seeded from `random`, Math.random by default and
 * read at the deal, so a test that seeds Math.random gets the same tens.
 */
export function anotherTen(source: Pick<PitchSource, 'deck'>, today: readonly Pitch[], random: () => number = () => Math.random()): AnotherTen {
  const todayIds = today.map((p) => p.id);
  const dealt = new Set<string>();
  // The deck in use once the source's first one has run dry. Until then, deck() gives the first one, loading it once.
  let later: Deck | null = null;
  const deck = (): Promise<Deck> => (later ? Promise.resolve(later) : source.deck());

  return {
    ready: async () => {
      await deck();
    },
    async deal() {
      const rand = mulberry32(Math.floor(random() * 2 ** 32));
      let d = await deck();

      for (;;) {
        const ten = dealFrom(d.pitches, new Set([...todayIds, ...dealt]), rand);

        if (ten) {
          for (const p of ten) dealt.add(p.id);

          return ten;
        }
        const next = await d.next();

        if (next) later = d = next;
        else if (dealt.size > 0) dealt.clear();
        else throw new Error("Another ten couldn't be dealt: the pitches have run short of close calls, near calls or calibrators.");
      }
    },
  };
}
