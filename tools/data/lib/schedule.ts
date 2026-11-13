import { GAME_TYPES, type GameType } from './constants.ts';
import type { ScheduleGame, ScheduleResponse, TeamsResponse } from './mlb.ts';

export interface Team {
  id: number;
  abbr: string;
  name: string;
}

export interface Named {
  id: number;
  name: string;
}

export interface Game {
  gamePk: number;
  date: string;
  // The schedule's gameDate: the scheduled start, in ISO UTC.
  start: string;
  gameType: GameType;
  awayId: number;
  homeId: number;
  series: string | null;
  seriesGame: number | null;
  venue: Named | null;
  // The plate umpire the schedule lists. A pitch's own plate umpire also follows the play log's umpire changes.
  scheduledUmpire: Named | null;
}

export interface ScheduleResult {
  games: Game[];
  skipped: Record<string, number>;
  // Every official named in any listing's crew, by id.
  officials: Map<number, string>;
}

const isGameType = (v: string | undefined): v is GameType => GAME_TYPES.some((t) => t === v);
const isUtcInstant = (v: string | undefined): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v);

const isFinal = (g: ScheduleGame): boolean =>
  g.status?.abstractGameState === 'Final' && (g.status.codedGameState === 'F' || g.status.codedGameState === 'O');

// Played order: by official date, then scheduled start, then gamePk. The ISO UTC strings sort as instants.
export function compareGames(a: { date: string; start: string; gamePk: number }, b: { date: string; start: string; gamePk: number }): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : a.gamePk - b.gamePk;
}

export function parseTeams(res: TeamsResponse): Map<number, Team> {
  const teams = new Map<number, Team>();

  for (const t of res.teams ?? []) {
    if (t.abbreviation) teams.set(t.id, { id: t.id, abbr: t.abbreviation, name: t.name ?? t.abbreviation });
  }

  return teams;
}

// Postponed and suspended games are listed again on the day they were completed, under the same gamePk, so only a
// final listing counts. A suspended game that was resumed has two final listings; the earlier one carries its original
// start.
export function parseSchedule(responses: ScheduleResponse[]): ScheduleResult {
  const listings = new Map<number, ScheduleGame[]>();
  const officials = new Map<number, string>();

  for (const res of responses) {
    for (const day of res.dates ?? []) {
      for (const g of day.games ?? []) {
        const seen = listings.get(g.gamePk);

        if (seen) seen.push(g);
        else listings.set(g.gamePk, [g]);
        for (const o of g.officials ?? []) if (o.official?.fullName) officials.set(o.official.id, o.official.fullName);
      }
    }
  }

  const games: Game[] = [];
  const skipped: Record<string, number> = {};

  for (const [gamePk, all] of listings) {
    const [g] = all.filter(isFinal).sort((a, b) => ((a.gameDate ?? '') < (b.gameDate ?? '') ? -1 : 1));
    const awayId = g?.teams?.away?.team?.id;
    const homeId = g?.teams?.home?.team?.id;
    const gameType = g?.gameType;
    const start = g?.gameDate;
    const why = !g
      ? (all.at(-1)?.status?.detailedState ?? 'unknown status')
      : !isGameType(gameType)
        ? `game type ${gameType ?? 'missing'}`
        : 'incomplete listing';

    if (!g || !isGameType(gameType) || !g.officialDate || !isUtcInstant(start) || awayId === undefined || homeId === undefined) {
      skipped[why] = (skipped[why] ?? 0) + 1;
      continue;
    }

    const post = gameType !== 'R';
    const plate = g.officials?.find((o) => o.officialType === 'Home Plate')?.official;

    games.push({
      gamePk,
      date: g.officialDate,
      start,
      gameType,
      awayId,
      homeId,
      series: post ? (g.seriesDescription ?? null) : null,
      seriesGame: post ? (g.seriesGameNumber ?? null) : null,
      venue: g.venue?.id !== undefined && g.venue.name ? { id: g.venue.id, name: g.venue.name } : null,
      scheduledUmpire: plate ? { id: plate.id, name: plate.fullName ?? `#${plate.id}` } : null,
    });
  }

  games.sort(compareGames);

  return { games, skipped, officials };
}
