import { CALIBRATOR_MIN_IN, CLOSE_IN, NEAR_IN } from './constants.ts';
import type { Judged } from './judge.ts';
import { unitHash } from './rng.ts';

export type Bucket = 'challenge' | 'close' | 'near' | 'calibrator';

export interface PoolEntry {
  j: Judged;
  bucket: Bucket;
  // What the app may deal: the mockup's crossing rule, and only for pitches it can draw.
  dealable: boolean;
}

export interface Pool {
  entries: PoolEntry[];
  clearEligible: number;
  undrawable: { close: number; near: number };
}

// One calibrator for every nine other dealable pitches, the proportion a round of ten uses them in.
export const CALIBRATOR_SHARE = 1 / 9;

const absMargin = (j: Judged): number => Math.abs(j.marginIn);

// The margin as stored (0.01 in), which is what the app and the validator classify by.
export const storedAbsMargin = (j: Judged): number => Math.abs(Math.round(j.marginIn * 100) / 100);

export function band(j: Judged): 'close' | 'near' | 'mid' | 'clear' {
  const m = absMargin(j);

  return m <= CLOSE_IN ? 'close' : m <= NEAR_IN ? 'near' : m < CALIBRATOR_MIN_IN ? 'mid' : 'clear';
}

// Every challenged pitch, every dealable pitch within 4.5 in of flipping, and a seeded sample of clear calls.
export function selectPool(all: readonly Judged[], seed: string): Pool {
  const entries: PoolEntry[] = [];
  const clear: Judged[] = [];
  const undrawable = { close: 0, near: 0 };

  for (const j of all) {
    const b = band(j);
    const dealable = j.dealable && j.renderable;

    if (j.p.challenge) entries.push({ j, bucket: 'challenge', dealable });
    else if (b === 'close' || b === 'near') {
      if (dealable) entries.push({ j, bucket: b, dealable });
      else if (j.dealable) undrawable[b]++;
    } else if (b === 'clear' && dealable) clear.push(j);
  }

  const others = entries.filter((e) => e.dealable && (band(e.j) === 'close' || band(e.j) === 'near')).length;
  const want = Math.min(clear.length, Math.round(others * CALIBRATOR_SHARE));
  const ranked = clear
    .map((j) => ({ j, h: unitHash(`${seed}|calibrator|${j.p.id}`) }))
    .sort((a, b) => a.h - b.h || a.j.seq - b.j.seq);

  for (const { j } of ranked.slice(0, want)) entries.push({ j, bucket: 'calibrator', dealable: true });
  entries.sort((a, b) => a.j.seq - b.j.seq);

  return { entries, clearEligible: clear.length, undrawable };
}

export function stratumOf(e: PoolEntry): string {
  const kind = e.bucket === 'challenge' ? `challenge-${band(e.j)}${e.dealable ? '' : '-undealable'}` : e.bucket;

  return `${kind}|${e.j.truth}|${e.j.p.bats}`;
}

// Each stratum is shuffled by a seeded hash and dealt round robin, continuing the rotation from one stratum to the
// next, so every shard gets its share of each kind of pitch to within one and the shard sizes differ by at most one.
export function makeShards(entries: readonly PoolEntry[], count: number, seed: string): PoolEntry[][] {
  const strata = new Map<string, PoolEntry[]>();
  const shards: PoolEntry[][] = Array.from({ length: count }, () => []);
  let next = 0;

  for (const e of entries) {
    const key = stratumOf(e);
    const list = strata.get(key);

    if (list) list.push(e);
    else strata.set(key, [e]);
  }
  for (const key of [...strata.keys()].sort()) {
    const ranked = (strata.get(key) ?? [])
      .map((e) => ({ e, h: unitHash(`${seed}|shard|${e.j.p.id}`) }))
      .sort((a, b) => a.h - b.h || a.e.j.seq - b.e.j.seq);

    for (const { e } of ranked) {
      shards[next % count]?.push(e);
      next++;
    }
  }
  for (const s of shards) s.sort((a, b) => a.j.seq - b.j.seq);

  return shards;
}
