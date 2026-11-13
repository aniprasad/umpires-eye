// Small synthetic season files for data:daily's tests: shards, stats and a manifest in the real format, built from a few
// fields per pitch. Every other cell is a fixed, valid value.
import { isDailyReserve } from '../../../src/core/daily.ts';
import { CREDIT, SEASON, TRUTH_NOTE } from '../../../src/core/rules.ts';
import {
  CHALLENGE_FIELDS,
  FORMAT_VERSION,
  GAME_FIELDS,
  MANIFEST_FORMAT,
  NAME_FIELDS,
  PITCH_FIELDS,
  PLAYER_FIELDS,
  SHARD_FORMAT,
  STATS_FORMAT,
  type PitchField,
  type Row,
} from '../../../src/core/schema.ts';
import { buildIdOf } from '../lib/build-id.ts';
import { DAILY_DIR, type DailyArgs, type DailyRun, generateDaily } from '../lib/daily.ts';
import { rowsJson } from '../lib/format.ts';
import { OUT_DIR } from '../lib/pipeline.ts';
import { compareGames } from '../lib/schedule.ts';

export interface SynthGame {
  gamePk: number;
  date: string;
  start: string;
}

export interface SynthPitch {
  gamePk: number;
  atBat: number;
  marginIn: number;
  challenged?: boolean;
  dealable?: boolean;
  bats?: 'L' | 'R';
  /** The batter's ID; by default one of two, by side. */
  batter?: number;
  type?: 'FF' | 'SL' | 'CH';
  balls?: number;
  strikes?: number;
  /** Which shard holds it; by default the pitches alternate between two shards. */
  shard?: number;
}

export interface SynthSeason {
  manifestText: string;
  statsText: string;
  shardTexts: Map<string, string>;
  build: string;
}

const PITCH_TYPES = { CH: ['Changeup', 'offspeed'], FF: ['Four-Seam Fastball', 'fastball'], SL: ['Slider', 'breaking'] };
const FIELDS = { games: GAME_FIELDS, venues: NAME_FIELDS, umpires: NAME_FIELDS, players: PLAYER_FIELDS, pitches: PITCH_FIELDS, challenge: CHALLENGE_FIELDS };
const PLAYERS: Record<number, Row> = { 11: [11, 'Lou Lefty', 74], 12: [12, 'Rex Righty', 73], 20: [20, 'Pat Pitcher', null], 30: [30, 'Cal Catcher', 72] };

export const idOf = (p: SynthPitch): string => `${p.gamePk}-${p.atBat}-1`;
const batterOf = (p: SynthPitch): number => p.batter ?? (p.bats === 'L' ? 11 : 12);

/** The first at-bat from `from` on whose first pitch's ID is (or, with `reserved` false, isn't) in the daily reserve. */
export function atBatFor(gamePk: number, from = 1, reserved = true): number {
  let atBat = from;

  while (isDailyReserve(`${gamePk}-${atBat}-1`) !== reserved) atBat++;

  return atBat;
}

function cells(p: SynthPitch): Row {
  const c: Record<PitchField, unknown> = {
    gamePk: p.gamePk,
    atBat: p.atBat,
    pitch: 1,
    inning: 1,
    top: 1,
    outs: 0,
    balls: p.balls ?? 0,
    strikes: p.strikes ?? 0,
    awayScore: 0,
    homeScore: 0,
    bases: 0,
    batter: batterOf(p),
    bats: p.bats ?? 'R',
    pitcher: 20,
    throws: 'R',
    umpire: 70,
    type: p.type ?? 'FF',
    mph: 95,
    x0: 0,
    y0: 50,
    z0: 2.5,
    vX0: 0,
    vY0: -130,
    vZ0: 0,
    aX: 0,
    aY: 0,
    aZ: 0,
    extension: 6.5,
    zoneTop: 3.4,
    zoneBottom: 1.6,
    ump: p.marginIn >= 0 ? 'S' : 'B',
    final: p.marginIn >= 0 ? 'S' : 'B',
    abs: p.marginIn >= 0 ? 'S' : 'B',
    marginIn: p.marginIn,
    dealable: p.dealable === false ? 0 : 1,
    challenge: p.challenged ? [30, 'HOM', 'C', 0] : null,
  };

  return PITCH_FIELDS.map((f) => c[f] as Row[number]);
}

/** Shards, stats and a manifest holding these games and pitches, stamped with their build id as data:build would. */
export function synthSeason(games: readonly SynthGame[], pitches: readonly SynthPitch[], shards = 2): SynthSeason {
  const gameOf = new Map(games.map((g) => [g.gamePk, g]));
  const played = (a: SynthPitch, b: SynthPitch): number => {
    const ga = gameOf.get(a.gamePk);
    const gb = gameOf.get(b.gamePk);

    return (ga && gb ? compareGames(ga, gb) : 0) || a.atBat - b.atBat;
  };
  const files = Array.from({ length: shards }, (_, i) => `shards/${String(i).padStart(2, '0')}.json`);
  const groups = files.map((_, i) => pitches.filter((p, k) => (p.shard ?? k % shards) === i).sort(played));
  const shardText = (group: readonly SynthPitch[], i: number, build: string | null): string => {
    const shardGames = [...new Set(group.map((p) => p.gamePk))].flatMap((pk) => gameOf.get(pk) ?? []).sort(compareGames);
    const players = [...new Set(group.flatMap((p) => [batterOf(p), 20, ...(p.challenged ? [30] : [])]))].sort((a, b) => a - b);
    const head = {
      format: SHARD_FORMAT,
      version: FORMAT_VERSION,
      season: SEASON,
      ...(build === null ? {} : { build }),
      shard: i,
      shards,
      credit: CREDIT,
      truthNote: TRUTH_NOTE,
      fields: FIELDS,
      pitchTypes: PITCH_TYPES,
    };

    return rowsJson(head, [
      ['games', shardGames.map((g): Row => [g.gamePk, g.date, g.start, 'R', 'AWY', 'HOM', null, null, 32])],
      ['venues', shardGames.length ? [[32, 'A Park']] : []],
      ['umpires', group.length ? [[70, 'Plate Ump']] : []],
      ['players', players.map((id): Row => PLAYERS[id] ?? [id, `Batter ${id}`, 70 + (id % 8)])],
      ['pitches', group.map(cells)],
    ]);
  };
  const statsText = (build: string | null): string =>
    `${JSON.stringify({ format: STATS_FORMAT, version: FORMAT_VERSION, season: SEASON, ...(build === null ? {} : { build }), credit: CREDIT, truthNote: TRUTH_NOTE }, null, 2)}\n`;
  const build = buildIdOf([...groups.map((g, i) => shardText(g, i, null)), statsText(null)]);
  const shardTexts = new Map(groups.map((g, i): [string, string] => [files[i] ?? '', shardText(g, i, build)]));
  const manifest = {
    format: MANIFEST_FORMAT,
    version: FORMAT_VERSION,
    season: SEASON,
    build,
    credit: CREDIT,
    truthNote: TRUTH_NOTE,
    pitchTypes: PITCH_TYPES,
    fields: FIELDS,
    shards: groups.map((g, i) => ({ file: files[i], pitches: g.length, dealable: g.filter((p) => p.dealable !== false).length, bytes: 0, sha256: '' })),
  };

  return { manifestText: `${JSON.stringify(manifest, null, 2)}\n`, statsText: statsText(build), shardTexts, build };
}

/**
 * Games and reserved, dealable pitches enough for about `days` days and more, spread over games, batter sides, pitch
 * types and counts, with a few pitches outside the reserve and a few reserved ones that can't be dealt.
 */
export function poolFor(days: number): { games: SynthGame[]; pitches: SynthPitch[] } {
  const count = Math.max(30, days * 2);
  const games = Array.from({ length: count }, (_, g): SynthGame => {
    const date = `2026-${String(4 + Math.floor(g / 28)).padStart(2, '0')}-${String(1 + (g % 28)).padStart(2, '0')}`;

    return { gamePk: 910_000 + g, date, start: `${date}T${17 + (g % 6)}:05:00Z` };
  });
  const kinds = [
    ...Array<string>(Math.ceil(days * 1.6)).fill('calibrator'),
    ...Array<string>(Math.ceil(days * 13)).fill('close'),
    ...Array<string>(Math.ceil(days * 1.6)).fill('near'),
    ...Array<string>(6).fill('outside'),
    ...Array<string>(6).fill('undealable'),
  ];
  const nextAtBat = new Map<number, number>();
  const pitches = kinds.map((kind, k): SynthPitch => {
    const gamePk = 910_000 + ((k * 7) % count);
    const atBat = atBatFor(gamePk, (nextAtBat.get(gamePk) ?? 0) + 1, kind !== 'outside');
    const size = kind === 'calibrator' ? 7 + (k % 5) : kind === 'near' ? 2 + (k % 3) * 0.8 : 0.1 + (k % 13) * 0.1;

    nextAtBat.set(gamePk, atBat);

    return {
      gamePk,
      atBat,
      marginIn: k % 2 ? size : -size,
      challenged: kind === 'close' && k % 5 === 0,
      dealable: kind !== 'undealable',
      bats: (k >> 1) % 2 ? 'L' : 'R',
      // Far more batters than a month's days use, so a month file's players table has rows to leave out.
      batter: 100 + ((k * 13) % 97),
      type: (['FF', 'SL', 'FF', 'CH'] as const)[k % 4],
      balls: k % 4,
      strikes: (k >> 2) % 3,
    };
  });

  return { games, pitches };
}

/** The month files a run wrote, keyed as the next run reads them: by path from the season folder. */
export function monthsOf(run: DailyRun): Map<string, string> {
  return new Map(
    [...run.files].filter(([rel]) => rel.startsWith(`${OUT_DIR}/${DAILY_DIR}/`)).map(([rel, text]): [string, string] => [rel.slice(OUT_DIR.length + 1), text]),
  );
}

export const manifestOf = (run: DailyRun): string => run.files.get(`${OUT_DIR}/manifest.json`) ?? '';

/** Runs data:daily on a season, as if its manifest were `manifestText` (by default the season's own). */
export function daily(season: SynthSeason, args: Partial<DailyArgs>, months = new Map<string, string>(), manifestText = season.manifestText): DailyRun {
  return generateDaily(manifestText, season.shardTexts, months, { today: '2026-11-13', ...args });
}

/** A season's manifest carrying an earlier run's daily block, as data:build would keep it. */
export function withDaily(season: SynthSeason, run: DailyRun): string {
  const manifest = JSON.parse(season.manifestText) as Record<string, unknown>;

  manifest.daily = run.daily;

  return `${JSON.stringify(manifest, null, 2)}\n`;
}
