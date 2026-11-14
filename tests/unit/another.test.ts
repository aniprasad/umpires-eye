import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tenProblems, type Card } from '../../src/core/deal.ts';
import { mulberry32, type Rand } from '../../src/core/rng.ts';
import { LoadError, type Deck, type PitchSource } from '../../src/data/source';
import { fromPoolFile, worldSeriesSource, type PoolFile } from '../../src/data/ws2026';
import { anotherTen } from '../../src/game/another';
import { dealFrom, playable } from '../../src/math/deal';
import type { Challenge, Pitch } from '../../src/math/types';
import { synthPitch } from './fixtures';

const ws = fromPoolFile(JSON.parse(readFileSync(new URL('../../public/data/ws-2026/pool.json', import.meta.url), 'utf8')) as PoolFile);
const CHALLENGE: Challenge = { by: 'Cal Catcher', byId: 30, byTeam: 'HOM', byRole: 'catcher', isOverturned: false };

const ids = (pitches: readonly Pitch[]): string[] => pitches.map((p) => p.id);
const sorted = (pitches: readonly Pitch[]): string[] => ids(pitches).sort();
const cardOf = (p: Pitch): Card => ({ id: p.id, seq: p.order, absMarginIn: Math.abs(p.edgeMarginIn), challenged: p.challenge !== null });
const pitchOf = (id: string, order: number, marginIn: number, challenged = false): Pitch =>
  synthPitch({ id, order, edgeMarginIn: marginIn, challenge: challenged ? CHALLENGE : null });

/** Exactly one ten's worth: a calibrator, eight close calls (the first challenged) and a near call. */
const oneTen = (name: string): Pitch[] => [
  pitchOf(`${name}0`, 0, 7),
  ...Array.from({ length: 8 }, (_, k) => pitchOf(`${name}${k + 1}`, k + 1, 0.5, k === 0)),
  pitchOf(`${name}9`, 9, 3),
];

/** A source whose decks follow one another, as a season's shards do. `onNext` hears which deck was asked for its next. */
function sourceOf(piles: readonly (readonly Pitch[])[], onNext: (k: number) => void = () => undefined) {
  const nexts = piles.map(() => 0);
  const decks = piles.map((pitches, k): Deck => ({
    pitches,
    next: () => {
      nexts[k] = (nexts[k] ?? 0) + 1;
      onNext(k);

      return Promise.resolve(decks[k + 1] ?? null);
    },
  }));
  const [first] = decks;

  if (!first) throw new Error('sourceOf needs a deck');

  return { nexts, deck: () => Promise.resolve(first) };
}

describe('Another ten over a page', () => {
  it("never deals Today's Ten or a pitch dealt earlier on the page, and starts over only once the deck can't deal", async () => {
    // the World Series deck with Today's Ten put back, for the dealer to leave out
    const deck = ws.pitches.filter(playable);
    const today = new Set(ids(ws.today));
    const another = anotherTen(sourceOf([deck]), ws.today, mulberry32(20261113));
    const dealt = new Set<string>();
    let tens = 0;

    expect(deck.filter((p) => today.has(p.id))).toHaveLength(10);
    for (;;) {
      const ten = ids(await another.deal());

      expect(ten.filter((id) => today.has(id))).toEqual([]);
      if (ten.some((id) => dealt.has(id))) break;
      for (const id of ten) dealt.add(id);
      tens++;
    }
    expect(dealFrom(deck, new Set([...today, ...dealt]), mulberry32(1))).toBeNull();
    expect(tens).toBeGreaterThan(5);
  });

  it("moves to the source's next deck when one can't deal, never back, and starts over on the last", async () => {
    const [a, b] = [oneTen('a'), oneTen('b')];
    const source = sourceOf([a, b]);
    const another = anotherTen(source, [], mulberry32(3));

    expect(sorted(await another.deal())).toEqual(sorted(a));
    expect(sorted(await another.deal())).toEqual(sorted(b));
    expect(source.nexts).toEqual([1, 0]);
    // b can't deal again and has no next deck, so the page starts over on b
    expect(sorted(await another.deal())).toEqual(sorted(b));
    expect(source.nexts).toEqual([1, 1]);
  });

  it("leaves Today's Ten out after a fresh start too, and says so when nothing else can deal a ten", async () => {
    const [mine, today] = [oneTen('m'), oneTen('t')];
    const another = anotherTen(sourceOf([[...mine, ...today]]), today, mulberry32(4));

    for (let k = 0; k < 3; k++) expect(sorted(await another.deal())).toEqual(sorted(mine));
    await expect(anotherTen(sourceOf([today]), today, mulberry32(4)).deal()).rejects.toThrow("Another ten couldn't be dealt");
  });

  it('deals the same tens from the same seed, and other tens from another', async () => {
    const three = async (seed: number): Promise<string[][]> => {
      const another = anotherTen(worldSeriesSource(ws), ws.today, mulberry32(seed));

      return [ids(await another.deal()), ids(await another.deal()), ids(await another.deal())];
    };

    expect(await three(7)).toEqual(await three(7));
    expect((await three(8))[0]).not.toEqual((await three(7))[0]);
  });

  it('asks the source for its deck again when it failed to load', async () => {
    let failures = 1;
    const ten = oneTen('r');
    const source: Pick<PitchSource, 'deck'> = {
      deck: () => (failures-- > 0 ? Promise.reject(new LoadError('network', 'Could not reach the pitches.')) : Promise.resolve({ pitches: ten, next: () => Promise.resolve(null) })),
    };
    const another = anotherTen(source, [], mulberry32(5));

    await expect(another.ready()).rejects.toMatchObject({ kind: 'network' });
    await another.ready();
    expect(sorted(await another.deal())).toEqual(sorted(ten));
  });
});

/** A deck of `n` pitches in played order: a fifth calibrators, a third close calls (some challenged), the rest farther. */
function randomDeck(name: string, n: number, rand: Rand): Pitch[] {
  return Array.from({ length: n }, (_, i) => {
    const [kind, u] = [rand(), rand()];
    const close = kind >= 0.2 && kind < 0.55;
    const size = kind < 0.2 ? 6 + 4 * u : close ? 1.5 * u : kind < 0.8 ? 1.6 + 2.9 * u : 4.6 + 1.3 * u;

    return pitchOf(`${name}${i}`, i, rand() < 0.5 ? size : -size, close && rand() < 0.3);
  });
}

describe('Another ten, property-style', () => {
  it('over 1,000 seeds and random decks, every ten keeps the rules, and a deck is left only when it cannot deal', async () => {
    const problems: string[] = [];
    let [moves, startOvers, givenUp] = [0, 0, 0];

    for (let seed = 1; seed <= 1000; seed++) {
      const rand = mulberry32(seed);
      const decks = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, d) => randomDeck(`d${d}-`, 15 + Math.floor(rand() * 46), rand));
      const all = decks.flat();
      const today = Array.from({ length: 10 }, () => all[Math.floor(rand() * all.length)]).filter((p): p is Pitch => p !== undefined);
      const todayIds = new Set(ids(today));
      const deckOf = new Map(decks.flatMap((deck, d) => deck.map((p): [string, number] => [p.id, d])));
      const last = decks.length - 1;
      // what the page has dealt since it last started over, as the dealer should see it
      let since = new Set<string>();
      let startedOver = false;
      const source = sourceOf(decks, (k) => {
        if (dealFrom(decks[k] ?? [], new Set([...todayIds, ...since]), mulberry32(1))) problems.push(`seed ${seed}: left deck ${k} while it could still deal`);
        if (k === last) startedOver = true;
      });
      const another = anotherTen(source, today, mulberry32(seed + 1_000_000));
      let at = 0;

      for (let k = 0; k < 4; k++) {
        let ten: Pitch[];

        startedOver = false;
        try {
          ten = await another.deal();
        } catch (e) {
          if (!(e instanceof Error) || !e.message.startsWith("Another ten couldn't be dealt")) throw e;
          if (dealFrom(decks[last] ?? [], todayIds, mulberry32(1))) problems.push(`seed ${seed}: gave up though a fresh start could deal`);
          givenUp++;
          break;
        }
        if (startedOver) {
          since = new Set();
          startOvers++;
        }
        const d = deckOf.get(ten[0]?.id ?? '') ?? -1;
        const why = [
          ...tenProblems(ten.map(cardOf)),
          ...(ten.some((p) => deckOf.get(p.id) !== d) ? ['a ten from two decks'] : []),
          ...(d < at ? ['back to an earlier deck'] : []),
          ...(ten.some((p) => todayIds.has(p.id)) ? ["one of Today's Ten"] : []),
          ...(ten.some((p) => since.has(p.id)) ? ['a pitch dealt earlier on the page'] : []),
        ];

        if (why.length) problems.push(`seed ${seed}, ten ${k + 1}: ${why.join('; ')}`);
        if (d > at) moves++;
        at = d;
        for (const p of ten) since.add(p.id);
      }
    }
    expect(problems).toEqual([]);
    // every path was taken: moving on, starting over, and giving up
    expect([moves, startOvers, givenUp].every((n) => n > 20)).toBe(true);
  });
});
