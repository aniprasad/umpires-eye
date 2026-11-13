import { CALIBRATOR_MIN_IN, CLOSE_IN, NEAR_IN } from './constants.ts';
import type { Judged } from './judge.ts';
import { unitHash } from './rng.ts';

export type Bucket = 'challenge' | 'close' | 'near' | 'calibrator';

export interface PoolEntry {
  j: Judged;
  bucket: Bucket;
  // What the app may deal: the mockup's crossing rule, and only for pitches it can show as they happened.
  dealable: boolean;
}

export interface Pool {
  entries: PoolEntry[];
  // Dealable pitches in each band over the whole season, challenged or not, before any sampling.
  season: { close: number; near: number; clear: number };
  notShowable: { close: number; near: number };
}

export interface Rates {
  near: number;
  calibrator: number;
}

// A round of ten deals eight close calls, one near call and one calibrator. So the pool keeps every close call and
// samples near calls and calibrators at one per eight close calls; change a rate and rebuild for a different mix.
export const PER_CLOSE: Rates = { near: 1 / 8, calibrator: 1 / 8 };

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// The margin as stored (0.01 in), which is what the app and the validator classify by.
export const storedAbsMargin = (j: Judged): number => Math.abs(Math.round(j.marginIn * 100) / 100);

export function band(j: Judged): 'close' | 'near' | 'mid' | 'clear' {
  const m = storedAbsMargin(j);

  return m <= CLOSE_IN ? 'close' : m <= NEAR_IN ? 'near' : m < CALIBRATOR_MIN_IN ? 'mid' : 'clear';
}

// Systematic sampling from a seeded start, over the candidates ordered by pitch type, then pitching team, then the
// order they were played. Every pitch type, and every team within it, keeps its share to within one pitch, and each
// one's picks are spread evenly through the season.
export function spreadSample(candidates: readonly Judged[], want: number, seed: string): Judged[] {
  if (want <= 0) return [];
  if (want >= candidates.length) return [...candidates];

  const ordered = [...candidates].sort(
    (a, b) => cmp(a.p.pitchType ?? '', b.p.pitchType ?? '') || a.p.pitchingTeamId - b.p.pitchingTeamId || a.seq - b.seq,
  );
  const step = ordered.length / want;
  const start = unitHash(seed) * step;
  const out: Judged[] = [];

  for (let k = 0; k < want; k++) {
    const pick = ordered[Math.floor(start + k * step)];

    if (pick) out.push(pick);
  }

  return out;
}

// Every challenged pitch and every dealable close call, plus spread-out samples of near calls and clear calls.
export function selectPool(all: readonly Judged[], seed: string, rates: Rates = PER_CLOSE): Pool {
  const entries: PoolEntry[] = [];
  const near: Judged[] = [];
  const clear: Judged[] = [];
  const season = { close: 0, near: 0, clear: 0 };
  const challenged = { near: 0, clear: 0 };
  const notShowable = { close: 0, near: 0 };

  for (const j of all) {
    const b = band(j);
    const dealable = j.inBox && j.showable;

    if (dealable && b !== 'mid') season[b]++;
    if (j.p.challenge) {
      entries.push({ j, bucket: 'challenge', dealable });
      if (dealable && (b === 'near' || b === 'clear')) challenged[b]++;
    } else if (dealable) {
      if (b === 'close') entries.push({ j, bucket: 'close', dealable });
      else if (b === 'near') near.push(j);
      else if (b === 'clear') clear.push(j);
    } else if (j.inBox && (b === 'close' || b === 'near')) {
      notShowable[b]++;
    }
  }

  // The dealer draws on challenged pitches too, so they count toward each pile's share.
  const want = (rate: number, already: number): number => Math.max(0, Math.round(season.close * rate) - already);

  for (const j of spreadSample(near, want(rates.near, challenged.near), `${seed}|near`)) {
    entries.push({ j, bucket: 'near', dealable: true });
  }
  for (const j of spreadSample(clear, want(rates.calibrator, challenged.clear), `${seed}|calibrator`)) {
    entries.push({ j, bucket: 'calibrator', dealable: true });
  }
  entries.sort((a, b) => a.j.seq - b.j.seq);

  return { entries, season, notShowable };
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
