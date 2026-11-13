import { SEASON } from '../../../src/core/rules.ts';
import { cachePaths, type Cache } from './cache.ts';
import { GAME_TYPES } from './constants.ts';
import type { PlayByPlay, RawPerson, ScheduleResponse, TeamsResponse } from './mlb.ts';
import { toPerson, type Person } from './people.ts';
import type { Inputs } from './pipeline.ts';

// Everything the build reads comes from the cache; null means data:fetch has not been run yet.
export function loadInputs(cache: Cache, log?: (line: string) => void): Inputs | null {
  const teams = cache.readJson<TeamsResponse>(cachePaths.teams(SEASON));
  const schedules = GAME_TYPES.map((t) => cache.readJson<ScheduleResponse>(cachePaths.schedule(SEASON, t)));

  if (!teams || schedules.some((s) => s === null)) return null;

  const people = new Map<number, Person>();

  for (const file of cache.list(cachePaths.peopleDir)) {
    const raw = cache.readJson<RawPerson>(`${cachePaths.peopleDir}/${file}`);

    if (raw) people.set(raw.id, toPerson(raw));
  }

  return {
    teams,
    schedules: schedules.filter((s): s is ScheduleResponse => s !== null),
    people,
    loadPlays: (gamePk) => cache.readJson<PlayByPlay>(cachePaths.playByPlay(gamePk)),
    ...(log ? { log } : {}),
  };
}
