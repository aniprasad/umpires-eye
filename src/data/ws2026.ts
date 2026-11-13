import type { Game, Pitch } from '../math/types';
import type { PitchData, PitchSource } from './source';

/**
 * Today's Ten for the World Series pool: one easy calibrator first, then eight close calls within 1.5 in of the ABS
 * edge (four balls, four strikes; the real ump right on five, near the 63% umps managed on pitches this close all
 * Series), then the Series' last called strike three. Game 5 supplies what it can; Games 1 and 2 add the breaking and
 * offspeed pitches Game 5 has none of this close. Calibrator first, the rest in Series order.
 */
export const WS_TODAY_IDS: readonly string[] = [
  '849799-1-1', '849805-40-6', '849802-14-2', '849802-31-5', '849799-5-4',
  '849799-9-1', '849799-13-2', '849799-31-1', '849799-51-1', '849799-65-7',
];

export const WS_LABEL = '2026 World Series';

/** The shape of public/data/ws-2026/pool.json (the mockup's pool.json, minified). */
export interface PoolFile {
  games: Game[];
  pitches: Pitch[];
}

export function fromPoolFile(file: PoolFile): PitchData {
  const byId = new Map(file.pitches.map((p) => [p.id, p]));
  const missing = WS_TODAY_IDS.filter((id) => !byId.has(id));

  if (missing.length) throw new Error(`Today's Ten pitches are missing from the pool: ${missing.join(', ')}`);

  return {
    label: WS_LABEL,
    games: file.games,
    pitches: file.pitches,
    today: WS_TODAY_IDS.map((id) => byId.get(id) as Pitch),
  };
}

/** The 742 called pitches of the 2026 World Series, fetched from a static JSON file. */
export function worldSeriesSource(url: string): PitchSource {
  return {
    id: 'ws-2026',
    async load(): Promise<PitchData> {
      const res = await fetch(url);

      if (!res.ok) throw new Error(`Could not load the pitch data (${res.status} ${res.statusText}).`);

      return fromPoolFile((await res.json()) as PoolFile);
    },
  };
}
