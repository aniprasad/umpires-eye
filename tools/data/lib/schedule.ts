import { GAME_TYPES, type GameType } from './constants.ts';
import type { ScheduleGame, ScheduleResponse, TeamsResponse } from './mlb.ts';

export interface Team {
  id: number;
  abbr: string;
  name: string;
}

export interface Game {
  gamePk: number;
  date: string;
  gameType: GameType;
  awayId: number;
  homeId: number;
  series: string | null;
  seriesGame: number | null;
}

export interface ScheduleResult {
  games: Game[];
  skipped: Record<string, number>;
}

const isGameType = (v: string | undefined): v is GameType => GAME_TYPES.some((t) => t === v);

const isFinal = (g: ScheduleGame): boolean =>
  g.status?.abstractGameState === 'Final' && (g.status.codedGameState === 'F' || g.status.codedGameState === 'O');

export function parseTeams(res: TeamsResponse): Map<number, Team> {
  const teams = new Map<number, Team>();

  for (const t of res.teams ?? []) {
    if (t.abbreviation) teams.set(t.id, { id: t.id, abbr: t.abbreviation, name: t.name ?? t.abbreviation });
  }

  return teams;
}

// Postponed and suspended games are listed again on the day they were completed, under the same gamePk, so only the
// final listing counts.
export function parseSchedule(responses: ScheduleResponse[]): ScheduleResult {
  const listings = new Map<number, ScheduleGame[]>();

  for (const res of responses) {
    for (const day of res.dates ?? []) {
      for (const g of day.games ?? []) {
        const seen = listings.get(g.gamePk);

        if (seen) seen.push(g);
        else listings.set(g.gamePk, [g]);
      }
    }
  }

  const games: Game[] = [];
  const skipped: Record<string, number> = {};

  for (const [gamePk, all] of listings) {
    const g = all.find(isFinal);
    const awayId = g?.teams?.away?.team?.id;
    const homeId = g?.teams?.home?.team?.id;
    const gameType = g?.gameType;
    const why = !g
      ? (all.at(-1)?.status?.detailedState ?? 'unknown status')
      : !isGameType(gameType)
        ? `game type ${gameType ?? 'missing'}`
        : 'incomplete listing';

    if (!g || !isGameType(gameType) || !g.officialDate || awayId === undefined || homeId === undefined) {
      skipped[why] = (skipped[why] ?? 0) + 1;
      continue;
    }

    const post = gameType !== 'R';

    games.push({
      gamePk,
      date: g.officialDate,
      gameType,
      awayId,
      homeId,
      series: post ? (g.seriesDescription ?? null) : null,
      seriesGame: post ? (g.seriesGameNumber ?? null) : null,
    });
  }

  games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.gamePk - b.gamePk));

  return { games, skipped };
}
