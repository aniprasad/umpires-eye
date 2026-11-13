import { playable, playPoints } from '../math/deal';
import type { PlayPoint } from '../math/lens';
import type { GameMeta, Pitch } from '../math/types';
import { fetchJson, type Net } from './fetch';
import { LoadError, type Deck, type PitchSource, type TodayResult, type UmpFigure } from './source';

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

/** The figure M1 cites: UmpScorecards, via mlb.com. */
const WS_UMP_FIGURE: UmpFigure = { pct: 94, label: 'MLB umps', definition: 'UmpScorecards via mlb.com', approx: true };

/** A game as public/data/ws-2026/pool.json (the mockup's pool.json, minified) stores it. */
export interface PoolGame {
  gamePk: number;
  /** The game's number in the Series, 1 to 5. */
  gameNumber: number;
  date: string;
  away: string;
  home: string;
  venue?: string;
  plateUmpire?: string;
}

/** A pitch as the pool file stores it: numbered by its game in the Series, which also gives its played order. */
export type PoolPitch = Omit<Pitch, 'game' | 'order' | 'plateUmpire'> & { gameNumber: number };

export interface PoolFile {
  games: PoolGame[];
  pitches: PoolPitch[];
}

/** The pool, read. */
export interface WorldSeries {
  readonly label: string;
  /** Every pitch in the file, in played order, playable or not: the self-test's mockup numbers count them all. */
  readonly pitches: readonly Pitch[];
  /** Today's Ten, in play order. */
  readonly today: readonly Pitch[];
  /** What Another ten deals from: the playable pitches, in played order, without Today's Ten. */
  readonly deck: readonly Pitch[];
  /** Today's Ten and every playable pitch, as M1 fitted the lens. */
  readonly lensPoints: readonly PlayPoint[];
}

/** The World Series source, with the pool behind it for the self-test. */
export interface WorldSeriesSource extends PitchSource {
  readonly id: 'ws-2026';
  readonly ws: WorldSeries;
}

const gameMeta = (g: PoolGame): GameMeta => ({
  gamePk: g.gamePk,
  date: g.date,
  away: g.away,
  home: g.home,
  label: `${WS_LABEL} · Game ${g.gameNumber}`,
  seriesGame: g.gameNumber,
  venue: g.venue ?? null,
});

/** Reads a pool file's parsed body. Throws a `data` LoadError for one that doesn't add up. */
export function fromPoolFile(body: unknown): WorldSeries {
  const { games: gameList, pitches: pitchList } = (typeof body === 'object' && body !== null ? body : {}) as Partial<PoolFile>;

  if (!Array.isArray(gameList) || !Array.isArray(pitchList)) throw new LoadError('data', 'The pitch data has no games or no pitches.');
  const file: PoolFile = { games: gameList, pitches: pitchList };
  const games = new Map(file.games.map((g) => [g.gamePk, g]));
  const metas = new Map(file.games.map((g) => [g.gamePk, gameMeta(g)]));
  const pitches = file.pitches.map(({ gameNumber, ...p }): Pitch => {
    const game = metas.get(p.gamePk);
    const [, atBat = 0, pitch = 0] = p.id.split('-').map(Number);

    if (!game) throw new LoadError('data', `Pitch ${p.id} is from game ${p.gamePk}, which isn't in the pool's games.`);

    // One plate umpire worked each game of the Series, so every pitch takes its game's.
    return { ...p, game, order: gameNumber * 1e6 + atBat * 100 + pitch, plateUmpire: games.get(p.gamePk)?.plateUmpire ?? null };
  });
  const byId = new Map(pitches.map((p) => [p.id, p]));
  const today = WS_TODAY_IDS.flatMap((id) => byId.get(id) ?? []);

  if (today.length < WS_TODAY_IDS.length) {
    throw new LoadError('data', `Today's Ten pitches are missing from the pool: ${WS_TODAY_IDS.filter((id) => !byId.has(id)).join(', ')}`);
  }
  const todayIds = new Set(WS_TODAY_IDS);

  return {
    label: WS_LABEL,
    pitches,
    today,
    deck: pitches.filter((p) => playable(p) && !todayIds.has(p.id)),
    lensPoints: playPoints(today, pitches),
  };
}

/** Serves a read pool through the source contract. The Series has one ten, whatever the date, and one deck. */
export function worldSeriesSource(ws: WorldSeries): WorldSeriesSource {
  const deck: Deck = { pitches: ws.deck, next: () => Promise.resolve(null) };

  return {
    id: 'ws-2026',
    label: ws.label,
    lensPoints: ws.lensPoints,
    ws,
    today: (dateKey) => Promise.resolve<TodayResult>({ kind: 'ten', dateKey, pitches: ws.today }),
    deck: () => Promise.resolve(deck),
    umpFigure: () => Promise.resolve(WS_UMP_FIGURE),
  };
}

export const isWorldSeries = (source: PitchSource): source is WorldSeriesSource => 'ws' in source;

/** The 742 called pitches of the 2026 World Series. The whole pool loads before the source is handed over. */
export async function loadWorldSeries(url: string, net?: Net): Promise<WorldSeriesSource> {
  return worldSeriesSource(fromPoolFile(await fetchJson(url, { what: 'the pitch data', net })));
}
