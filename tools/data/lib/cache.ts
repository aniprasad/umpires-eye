import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

export interface Cache {
  dir: string;
  has: (rel: string) => boolean;
  readText: (rel: string) => string | null;
  readJson: <T>(rel: string) => T | null;
  writeText: (rel: string, text: string) => void;
  list: (relDir: string) => string[];
}

export const cachePaths = {
  teams: (season: number): string => `statsapi-v1/teams/${season}.json.gz`,
  // Schedules are fetched with hydrate=officials for the plate umpire, so they are kept apart from plain ones.
  schedule: (season: number, gameType: string): string => `statsapi-v1/schedule/${season}-${gameType}-officials.json.gz`,
  playByPlay: (gamePk: number): string => `statsapi-v1/playByPlay/${gamePk}.json.gz`,
  peopleDir: 'statsapi-v1/people',
  person: (id: number): string => `statsapi-v1/people/${id}.json.gz`,
};

// Raw responses live outside the repo and every worktree shares them, so nothing is downloaded twice.
export function cacheDir(env: Record<string, string | undefined> = process.env): string {
  if (env.UE_CACHE_DIR) return env.UE_CACHE_DIR;

  const base = env.LOCALAPPDATA ?? env.XDG_CACHE_HOME ?? join(homedir(), '.cache');

  return join(base, 'umpires-eye', 'mlb-cache');
}

export function openCache(dir: string): Cache {
  const path = (rel: string): string => join(dir, rel);
  const readText = (rel: string): string | null =>
    existsSync(path(rel)) ? gunzipSync(readFileSync(path(rel))).toString('utf8') : null;

  return {
    dir,
    has: (rel) => existsSync(path(rel)),
    readText,
    readJson: <T>(rel: string): T | null => {
      const text = readText(rel);

      return text === null ? null : (JSON.parse(text) as T);
    },
    // Written beside the target and renamed into place, so an interrupted run never leaves half a file behind.
    writeText: (rel, text) => {
      const file = path(rel);
      const tmp = `${file}.${process.pid}.tmp`;

      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(tmp, gzipSync(text));
      renameSync(tmp, file);
    },
    list: (relDir) => (existsSync(path(relDir)) ? readdirSync(path(relDir)).filter((f) => f.endsWith('.json.gz')) : []),
  };
}
