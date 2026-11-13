import { LoadError, type PitchSource } from './source';
import { loadWorldSeries } from './ws2026';

const POOLS = new Map<string, PitchSource['id']>([['ws', 'ws-2026']]);

/** The source without a ?pool=, or with one the app doesn't know. */
export const DEFAULT_SOURCE: PitchSource['id'] = 'ws-2026';

/** Which source ?pool= asks for: `ws` is the World Series pool. Any other value is ignored. */
export const sourceIdOf = (pool: string | null): PitchSource['id'] => POOLS.get(pool ?? '') ?? DEFAULT_SOURCE;

/** Opens a source with what it needs before play. Rejects with a LoadError. */
export function openSource(id: PitchSource['id'], base: string): Promise<PitchSource> {
  switch (id) {
    case 'ws-2026':
      return loadWorldSeries(`${base}data/ws-2026/pool.json`);
    case 'season-2026':
      return Promise.reject(new LoadError('data', "The 2026 season can't be played yet."));
  }
}
