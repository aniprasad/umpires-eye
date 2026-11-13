// npm run data:fetch: downloads what the 2026 dataset is built from into the shared cache (UE_CACHE_DIR, or
// %LOCALAPPDATA%\umpires-eye\mlb-cache). Anything already cached is never fetched again.
import { cacheDir, cachePaths, openCache } from './lib/cache.ts';
import { GAME_TYPES, SEASON } from './lib/constants.ts';
import { describeError, getText, mapLimit } from './lib/http.ts';
import type { PeopleResponse, PlayByPlay, ScheduleResponse, TeamsResponse } from './lib/mlb.ts';
import { peopleIdsIn } from './lib/plays.ts';
import { parseSchedule } from './lib/schedule.ts';

const API = 'https://statsapi.mlb.com/api/v1';
const CONCURRENCY = 4;
const PEOPLE_BATCH = 100;

const cache = openCache(cacheDir());
const failures: string[] = [];
const totals = { requests: 0, wireBytes: 0 };
const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

async function download(url: string): Promise<string> {
  const res = await getText(url, { log: (line) => console.log(line) });

  JSON.parse(res.text);
  totals.requests++;
  totals.wireBytes += res.wireBytes ?? 0;

  return res.text;
}

async function cachedJson<T>(rel: string, url: string): Promise<T> {
  const hit = cache.readJson<T>(rel);

  if (hit !== null) return hit;

  const text = await download(url);

  cache.writeText(rel, text);

  return JSON.parse(text) as T;
}

console.log(`MLB Stats API cache: ${cache.dir}`);

await cachedJson<TeamsResponse>(cachePaths.teams(SEASON), `${API}/teams?sportId=1&season=${SEASON}`);

const schedules: ScheduleResponse[] = [];

for (const t of GAME_TYPES) {
  schedules.push(
    await cachedJson<ScheduleResponse>(cachePaths.schedule(SEASON, t), `${API}/schedule?sportId=1&season=${SEASON}&gameType=${t}`),
  );
}

const { games, skipped } = parseSchedule(schedules);
const todo = games.filter((g) => !cache.has(cachePaths.playByPlay(g.gamePk)));
let done = 0;

console.log(`${games.length} completed games (${GAME_TYPES.map((t) => `${t} ${games.filter((g) => g.gameType === t).length}`).join(', ')})`);
if (Object.keys(skipped).length) console.log(`  not completed: ${JSON.stringify(skipped)}`);
console.log(`${games.length - todo.length} game feeds already cached; fetching ${todo.length}`);

await mapLimit(todo, CONCURRENCY, async (g) => {
  try {
    cache.writeText(cachePaths.playByPlay(g.gamePk), await download(`${API}/game/${g.gamePk}/playByPlay`));
  } catch (err) {
    failures.push(`game ${g.gamePk}: ${describeError(err)}`);
  }
  done++;
  if (done % 50 === 0 || done === todo.length) console.log(`  ${done}/${todo.length} games, ${mb(totals.wireBytes)} so far`);
});

const ids = new Set<number>();

for (const g of games) {
  const pbp = cache.readJson<PlayByPlay>(cachePaths.playByPlay(g.gamePk));

  if (pbp) for (const id of peopleIdsIn(pbp)) ids.add(id);
}

const wanted = [...ids].filter((id) => !cache.has(cachePaths.person(id))).sort((a, b) => a - b);
const batches: number[][] = [];

for (let k = 0; k < wanted.length; k += PEOPLE_BATCH) batches.push(wanted.slice(k, k + PEOPLE_BATCH));
console.log(`${ids.size} players needed, ${wanted.length} not cached yet`);

await mapLimit(batches, CONCURRENCY, async (batch) => {
  try {
    const res = JSON.parse(await download(`${API}/people?personIds=${batch.join(',')}`)) as PeopleResponse;
    const returned = new Set<number>();

    for (const person of res.people ?? []) {
      cache.writeText(cachePaths.person(person.id), JSON.stringify(person));
      returned.add(person.id);
    }
    for (const id of batch) {
      if (!returned.has(id)) failures.push(`person ${id}: not returned by /people`);
    }
  } catch (err) {
    failures.push(`people ${batch[0]}..${batch.at(-1)}: ${describeError(err)}`);
  }
});

console.log(`done: ${totals.requests} requests, ${mb(totals.wireBytes)} over the wire`);
if (failures.length) {
  console.error(`${failures.length} failures (rerun to retry them):\n  ${failures.slice(0, 20).join('\n  ')}`);
  process.exitCode = 1;
}
