import type { PitchSource } from './source';
import { seasonSource } from './season2026';
import { loadWorldSeries } from './ws2026';

const POOLS = new Map<string, PitchSource['id']>([['ws', 'ws-2026'], ['season', 'season-2026']]);

/** The source without a ?pool=, or with one the app doesn't know. */
export const DEFAULT_SOURCE: PitchSource['id'] = 'season-2026';

/**
 * Which source ?pool= asks for: `ws` is the World Series pool, `season` the 2026 season. Any other value is ignored. The
 * self-test's figures are the mockup's, so ?selftest=1 without a ?pool= keeps the World Series.
 */
export const sourceIdOf = (pool: string | null, selftest = false): PitchSource['id'] => POOLS.get(pool ?? (selftest ? 'ws' : '')) ?? DEFAULT_SOURCE;

/** Opens a source with what it needs before play. Rejects with a LoadError. */
export function openSource(id: PitchSource['id'], base: string): Promise<PitchSource> {
  switch (id) {
    case 'ws-2026':
      return loadWorldSeries(`${base}data/ws-2026/pool.json`);
    case 'season-2026':
      return Promise.resolve(seasonSource({ root: `${base}data/season-2026/` }));
  }
}
