// data:daily's schedule (docs/M2-DESIGN.md §2): Today's Ten for each date of the horizon, drawn from the daily reserve,
// with the month files already written as a history lock. Pure: it takes the files' texts and returns new ones.
import { createHash } from 'node:crypto';
import {
  DAILY_RESERVE,
  isDailyReserve,
  monthOf,
  varietyProblems,
  type DailyDay,
  type DailyFileMeta,
  type ManifestDaily,
  type VarietyCard,
} from '../../../src/core/daily.ts';
import { dealTen, pilesOf, tenProblems, type Piles } from '../../../src/core/deal.ts';
import { decodeTables } from '../../../src/core/decode.ts';
import { hash32, mulberry32 } from '../../../src/core/rng.ts';
import { CREDIT, SEASON, SEED, TRUTH_NOTE } from '../../../src/core/rules.ts';
import {
  DAILY_FORMAT,
  FORMAT_VERSION,
  SHARD_FORMAT,
  type Fields,
  type ManifestDoc,
  type ShardDoc,
  type StoredGame,
  type StoredPitch,
} from '../../../src/core/schema.ts';
import { OUT_DIR } from './pipeline.ts';
import { compareGames } from './schedule.ts';

export const DAILY_DIR = 'daily';
export const DAILY_REPORT_PATH = 'tools/data/reports/season-2026-daily.json';
// A day whose draws keep failing the variety rules this often can't be dealt from what's left: it's an error, not luck.
const MAX_TRIES = 200;

type Row = unknown[];

/** A pool pitch as the schedule reads it: what the rules need, and its row exactly as its shard stores it. */
export interface SeasonPitch extends VarietyCard {
  p: StoredPitch;
  row: Row;
  dealable: boolean;
  shard: string;
}

/** Every shard of one build, read together. A row that two shards hold must be the same in both. */
export interface Season {
  build: string;
  fields: Fields;
  pitchTypes: Record<string, [string, string]>;
  /** Every pool pitch by ID. Its seq is its place in the season's played order: date, start, gamePk, at-bat, pitch. */
  pitches: Map<string, SeasonPitch>;
  games: Map<number, { game: StoredGame; row: Row }>;
  venues: Map<number, Row>;
  umpires: Map<number, Row>;
  players: Map<number, Row>;
}

export interface DailyArgs {
  /** The first date with a Today's Ten. Only the first run takes it; the schedule's start never moves. */
  from?: string;
  /**
   * Schedule through this date. The recorded last date is the default, and an earlier one is refused: the schedule never
   * shrinks.
   */
  through?: string;
  /** The last date that may have been served. It never moves backwards. */
  servedThrough?: string;
  /** The run's UTC date: the default servedThrough is the day after it, the latest local date anywhere. */
  today: string;
  /** Reproduce the recorded schedule, with its recorded servedThrough and last date and no new dates. */
  check?: boolean;
}

export interface DailyRun {
  /** The month files, the manifest and the daily report, by path from the repo's root. */
  files: Map<string, string>;
  daily: ManifestDaily;
  /** What this run changed, for the console. */
  log: string[];
}

interface DayDeal {
  ten: SeasonPitch[] | null;
  tries: number;
  rejected: string[];
  short: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export function isDateKey(s: unknown): s is string {
  const t = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;

  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function datesFrom(first: string, last: string): string[] {
  const out: string[] = [];

  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);

  return out;
}

const later = (a: string | undefined, b: string | undefined): string | undefined => (a === undefined ? b : b === undefined || a >= b ? a : b);

function keepRow<T>(map: Map<number, T>, id: number, value: T, row: Row, rowOf: (v: T) => Row, where: string): void {
  const before = map.get(id);

  if (before === undefined) map.set(id, value);
  else if (JSON.stringify(rowOf(before)) !== JSON.stringify(row)) throw new Error(`${where} differs between shards`);
}

/** Reads every shard the manifest lists, checking each is from the manifest's build and that shared rows agree. */
export function readSeason(manifest: ManifestDoc, shardTexts: ReadonlyMap<string, string>): Season {
  const season: Season = {
    build: manifest.build,
    fields: manifest.fields,
    pitchTypes: manifest.pitchTypes,
    pitches: new Map(),
    games: new Map(),
    venues: new Map(),
    umpires: new Map(),
    players: new Map(),
  };
  const unordered: Array<Omit<SeasonPitch, 'seq'>> = [];
  const seen = new Set<string>();

  for (const meta of manifest.shards) {
    const text = shardTexts.get(meta.file);

    if (text === undefined) throw new Error(`${meta.file} is missing`);

    const doc = JSON.parse(text) as ShardDoc;
    const tables = decodeTables(doc, SHARD_FORMAT);

    if (doc.build !== manifest.build) throw new Error(`${meta.file} is from build ${doc.build}, not the manifest's ${manifest.build}`);
    if (JSON.stringify(doc.fields) !== JSON.stringify(manifest.fields)) throw new Error(`${meta.file} lists other fields than the manifest`);
    tables.games.forEach((game, i) => {
      const row = doc.games[i] ?? [];

      keepRow(season.games, game.gamePk, { game, row }, row, (v) => v.row, `game ${game.gamePk}`);
    });
    for (const table of ['venues', 'umpires', 'players'] as const) {
      const at = doc.fields[table].indexOf('id');

      for (const row of doc[table]) keepRow(season[table], Number(row[at]), row, row, (v) => v, `${table} row ${String(row[at])}`);
    }
    tables.pitches.forEach((p, i) => {
      if (seen.has(p.id)) throw new Error(`${p.id} is in two shards`);
      seen.add(p.id);
      unordered.push({
        id: p.id,
        absMarginIn: Math.abs(p.marginIn),
        challenged: p.challenge !== null,
        gamePk: p.gamePk,
        bats: p.bats,
        family: (p.type === null ? undefined : tables.pitchTypes.get(p.type)?.family) ?? 'other',
        balls: p.balls,
        strikes: p.strikes,
        p,
        row: doc.pitches[i] ?? [],
        dealable: p.dealable,
        shard: meta.file,
      });
    });
  }

  const order = (pk: number): StoredGame | undefined => season.games.get(pk)?.game;

  unordered.sort((a, b) => {
    const ga = order(a.gamePk);
    const gb = order(b.gamePk);

    return (ga && gb ? compareGames(ga, gb) : 0) || a.p.atBat - b.p.atBat || a.p.pitch - b.p.pitch;
  });
  unordered.forEach((c, seq) => season.pitches.set(c.id, { ...c, seq }));

  return season;
}

/**
 * The history the month files hold: each date's ten IDs. A month file the manifest doesn't list, or a listed one that's
 * gone, would lose history silently, so either is an error, as is a broken lock: a date outside its month, a day without
 * ten IDs, an ID on two dates or one outside the reserve.
 */
export function readLock(daily: ManifestDaily | undefined, monthTexts: ReadonlyMap<string, string>): Map<string, string[]> {
  const listed = daily?.files ?? [];
  const unlisted = [...monthTexts.keys()].filter((file) => !listed.some((meta) => meta.file === file));
  const lock = new Map<string, string[]>();
  const holder = new Map<string, string>();

  if (unlisted.length) throw new Error(`The manifest's daily block doesn't list ${unlisted.join(', ')}, so the history can't be read`);
  for (const meta of listed) {
    const text = monthTexts.get(meta.file);

    if (text === undefined) throw new Error(`${meta.file} is listed in the manifest but missing, so its history is lost`);

    const doc: unknown = JSON.parse(text);

    if (!isRecord(doc) || doc.month !== meta.month || !isRecord(doc.days)) throw new Error(`${meta.file} isn't the month file for ${meta.month}`);
    for (const [date, day] of Object.entries(doc.days)) {
      const ids: unknown = isRecord(day) ? day.ids : undefined;

      if (!isDateKey(date) || monthOf(date) !== meta.month) throw new Error(`${meta.file} holds ${date}, which isn't a date in ${meta.month}`);
      if (!Array.isArray(ids) || ids.length !== 10 || !ids.every((id): id is string => typeof id === 'string')) {
        throw new Error(`${meta.file} ${date}: not ten pitch IDs`);
      }
      for (const id of ids) {
        const other = holder.get(id);

        if (other) throw new Error(`${id} is scheduled on both ${other} and ${date}`);
        if (!isDailyReserve(id)) throw new Error(`${meta.file} ${date}: ${id} isn't in the daily reserve`);
        holder.set(id, date);
      }
      lock.set(date, ids);
    }
  }

  return lock;
}

function shortOf(piles: Piles<SeasonPitch>): string {
  return [
    piles.closeChallenged.length < 1 ? 'challenged close calls' : '',
    piles.close.length < 8 ? 'close calls' : '',
    piles.near.length < 1 ? 'near calls' : '',
    piles.calibrators.length < 1 ? 'calibrators' : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * One date's ten, from the reserve minus every ID another day holds. A ten that breaks a variety rule is drawn again
 * from the same seeded stream, so a date always gets the same ten from the same piles.
 */
function dealDay(date: string, reserve: readonly SeasonPitch[], held: ReadonlySet<string>): DayDeal {
  const piles = pilesOf(reserve.filter((c) => !held.has(c.id)));
  const rand = mulberry32(hash32(`${SEED}|today|${date}`));
  const rejected: string[] = [];

  for (let tries = 1; tries <= MAX_TRIES; tries++) {
    const ten = dealTen(piles, rand);

    if (!ten) return { ten: null, tries, rejected, short: `the reserve has run out of ${shortOf(piles)}` };

    const problems = varietyProblems(ten);

    if (!problems.length) return { ten, tries, rejected, short: '' };
    rejected.push(...new Set(problems.map((p) => p.split(':')[0] ?? p)));
  }

  return { ten: null, tries: MAX_TRIES, rejected, short: `no draw passed the variety rules in ${MAX_TRIES} tries` };
}

const pileSizes = (piles: Piles<SeasonPitch>) => ({
  calibrators: piles.calibrators.length,
  close: piles.close.length,
  closeChallenged: piles.closeChallenged.length,
  near: piles.near.length,
});

function triesTally(tries: readonly number[]) {
  const histogram: Record<string, number> = {};

  for (const t of tries) histogram[t] = (histogram[t] ?? 0) + 1;

  return {
    mean: tries.length ? Math.round((tries.reduce((a, b) => a + b, 0) / tries.length) * 100) / 100 : 0,
    max: Math.max(0, ...tries),
    histogram,
  };
}

/**
 * The generator run from the first date with no history until the reserve can't deal a ten. It measures the no-repeat
 * horizon and the draws the variety rules take, on the shards alone, so it's the same on every run.
 */
function freshRun(first: string, reserve: readonly SeasonPitch[]) {
  const held = new Set<string>();
  const days: Array<{ date: string; ids: string[]; tries: number }> = [];
  const rejected = new Map<string, number>();

  for (let date = first; ; date = addDays(date, 1)) {
    const deal = dealDay(date, reserve, held);

    for (const rule of deal.rejected) rejected.set(rule, (rejected.get(rule) ?? 0) + 1);
    if (!deal.ten) return { days, rejected, stoppedOn: date, stoppedBy: deal.short };
    days.push({ date, ids: deal.ten.map((c) => c.id), tries: deal.tries });
    for (const c of deal.ten) held.add(c.id);
  }
}

function monthJson(head: object, days: ReadonlyArray<[string, DailyDay]>, tables: ReadonlyArray<[string, readonly Row[]]>): string {
  const parts = [JSON.stringify(head).slice(0, -1), `,\n"days":{\n${days.map(([date, day]) => `${JSON.stringify(date)}:${JSON.stringify(day)}`).join(',\n')}\n}`];

  for (const [name, rows] of tables) parts.push(`,\n${JSON.stringify(name)}:[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]`);

  return `${parts.join('')}}\n`;
}

/** A month file: its days, and the rows of its available days copied from their shards, every table trimmed to them. */
function monthText(month: string, days: ReadonlyArray<[string, DailyDay]>, season: Season): string {
  const rows = days.flatMap(([, day]) => (day.available ? day.ids.flatMap((id) => season.pitches.get(id) ?? []) : []));
  const games = [...new Set(rows.map((c) => c.gamePk))]
    .flatMap((pk) => season.games.get(pk) ?? [])
    .sort((a, b) => compareGames(a.game, b.game));
  const ids = (list: ReadonlyArray<number | null | undefined>): number[] =>
    [...new Set(list.filter((id): id is number => typeof id === 'number'))].sort((a, b) => a - b);
  const tableRows = (map: ReadonlyMap<number, Row>, wanted: readonly number[]): Row[] =>
    wanted.flatMap((id) => {
      const row = map.get(id);

      return row ? [row] : [];
    });
  const types = [...new Set(rows.flatMap((c) => (c.p.type === null ? [] : [c.p.type])))].sort();
  const head = {
    format: DAILY_FORMAT,
    version: FORMAT_VERSION,
    season: SEASON,
    month,
    build: season.build,
    credit: CREDIT,
    truthNote: TRUTH_NOTE,
    fields: season.fields,
    pitchTypes: Object.fromEntries(types.flatMap((t) => (season.pitchTypes[t] ? [[t, season.pitchTypes[t]]] : []))),
  };

  return monthJson(head, days, [
    ['games', games.map((g) => g.row)],
    ['venues', tableRows(season.venues, ids(games.map((g) => g.game.venue)))],
    ['umpires', tableRows(season.umpires, ids(rows.map((c) => c.p.umpire)))],
    ['players', tableRows(season.players, ids(rows.flatMap((c) => [c.p.batter, c.p.pitcher, c.p.challenge?.by])))],
    ['pitches', rows.map((c) => c.row)],
  ]);
}

/**
 * The schedule from the shards and the history lock (docs/M2-DESIGN.md §2.5). A day in the history stays as it is while
 * all ten of its pitches are still dealable in the pool. A day that has lost one stays, unavailable, if it may have been
 * served, and is dealt again if it can't have been. So is a day not yet served that no longer passes the rules of the
 * round. Every other date up to the last is dealt fresh. No ID is ever scheduled twice.
 */
export function generateDaily(
  manifestText: string,
  shardTexts: ReadonlyMap<string, string>,
  monthTexts: ReadonlyMap<string, string>,
  args: DailyArgs,
): DailyRun {
  const manifest = JSON.parse(manifestText) as ManifestDoc;
  const recorded = manifest.daily;

  for (const d of [args.from, args.through, args.servedThrough]) {
    if (d !== undefined && !isDateKey(d)) throw new Error(`${d} isn't a date, YYYY-MM-DD`);
  }
  if (args.check && !recorded) throw new Error('There is no schedule to check: the manifest has no daily block.');
  if (recorded && args.from !== undefined && args.from !== recorded.first) {
    throw new Error(`The schedule starts on ${recorded.first}, and --from can't move it.`);
  }
  if (recorded && args.through !== undefined && args.through < recorded.last) {
    throw new Error(`The schedule runs to ${recorded.last} and never shrinks, so --through can't be ${args.through}.`);
  }

  const first = recorded?.first ?? args.from;
  const last = args.check ? recorded?.last : later(recorded?.last, args.through);
  const servedThrough = args.check ? recorded?.servedThrough : later(recorded?.servedThrough, args.servedThrough ?? addDays(args.today, 1));

  if (!first) throw new Error("The first run needs --from YYYY-MM-DD, the first date with a Today's Ten.");
  if (!last) throw new Error('The first run needs --through YYYY-MM-DD, the last date to schedule.');
  if (!servedThrough) throw new Error('No servedThrough date.');
  if (last < first) throw new Error(`The last date, ${last}, is before the first, ${first}.`);

  const season = readSeason(manifest, shardTexts);
  const lock = readLock(recorded, monthTexts);
  const reserve = [...season.pitches.values()].filter((c) => c.dealable && isDailyReserve(c.id)).sort((a, b) => a.seq - b.seq);
  const days = new Map<string, DailyDay>();
  const held = new Set<string>();
  const log: string[] = [];
  const kept = { available: 0, unavailable: 0 };

  for (const [date, ids] of lock) {
    if (date < first || date > last) throw new Error(`The history holds ${date}, outside the schedule's ${first} to ${last}.`);

    const served = date <= servedThrough;
    const cards = ids.flatMap((id) => season.pitches.get(id) ?? []);
    const missing = ids.filter((id) => !season.pitches.get(id)?.dealable);
    const problems = missing.length ? [] : [...tenProblems(cards), ...varietyProblems(cards)];

    if ((missing.length || problems.length) && !served) {
      log.push(`re-dealt ${date}: ${missing.length ? `${missing.join(', ')} left the pool or can't be dealt` : problems.join('; ')}`);
      continue;
    }
    if (missing.length) {
      days.set(date, { ids, available: false, missing });
      kept.unavailable++;
      log.push(`unavailable ${date}: ${missing.join(', ')} left the pool or can't be dealt`);
    } else {
      days.set(date, { ids, available: true });
      kept.available++;
      if (problems.length) log.push(`drift on served day ${date}, kept as it is: ${problems.join('; ')}`);
    }
    for (const id of ids) held.add(id);
  }

  const dates = datesFrom(first, last);
  let dealt = 0;

  for (const date of dates) {
    if (days.has(date)) continue;

    const deal = dealDay(date, reserve, held);

    if (!deal.ten) throw new Error(`The reserve can't deal ${date}: ${deal.short}. Schedule fewer dates.`);
    days.set(date, { ids: deal.ten.map((c) => c.id), available: true });
    for (const c of deal.ten) held.add(c.id);
    dealt++;
  }

  const months = [...new Set(dates.map(monthOf))];
  const texts = months.map((month) =>
    monthText(
      month,
      dates.filter((d) => monthOf(d) === month).flatMap((d): Array<[string, DailyDay]> => {
        const day = days.get(d);

        return day ? [[d, day]] : [];
      }),
      season,
    ),
  );
  const files: DailyFileMeta[] = months.map((month, i) => ({
    month,
    file: `${DAILY_DIR}/${month}.json`,
    bytes: Buffer.byteLength(texts[i] ?? ''),
    sha256: sha256(texts[i] ?? ''),
  }));
  const daily: ManifestDaily = { first, last, servedThrough, reserve: { share: DAILY_RESERVE, pitches: reserve.length }, files };
  const next: ManifestDoc = { ...manifest };

  delete next.daily;
  next.daily = daily;

  const fresh = freshRun(first, reserve);
  const shipped = fresh.days.filter((d) => d.date <= last);
  const unavailable = dates.filter((d) => days.get(d)?.available === false);
  const report = {
    note: 'Written by npm run data:daily. Deterministic: the same shards, month files and recorded dates give the same file.',
    season: SEASON,
    build: season.build,
    schedule: { first, last, servedThrough, days: dates.length, available: dates.length - unavailable.length, unavailable },
    reserve: {
      share: DAILY_RESERVE,
      pitches: reserve.length,
      piles: pileSizes(pilesOf(reserve)),
      leftAfterSchedule: pileSizes(pilesOf(reserve.filter((c) => !held.has(c.id)))),
    },
    freshRun: {
      note: "The generator run from the first date with no history until the reserve can't deal a ten: the no-repeat horizon, and the draws the variety rules took.",
      days: fresh.days.length,
      last: fresh.days.at(-1)?.date ?? null,
      stoppedOn: fresh.stoppedOn,
      stoppedBy: fresh.stoppedBy,
      tries: triesTally(fresh.days.map((d) => d.tries)),
      rejectedByRule: Object.fromEntries([...fresh.rejected].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
      throughLast: {
        days: shipped.length,
        tries: triesTally(shipped.map((d) => d.tries)),
        sameAsSchedule: shipped.length === dates.length && shipped.every((d) => JSON.stringify(d.ids) === JSON.stringify(days.get(d.date)?.ids)),
      },
    },
  };

  log.unshift(
    `schedule ${first} to ${last}, ${dates.length} days; served through ${servedThrough}; ${kept.available + kept.unavailable} kept from the history (${kept.unavailable} unavailable), ${dealt} dealt`,
  );
  log.push(
    `reserve: ${reserve.length} dealable pitches; fresh run reaches ${report.freshRun.last} (${fresh.days.length} days) before ${fresh.stoppedBy}; tries per day ${report.freshRun.tries.mean} on average, ${report.freshRun.tries.max} at most`,
  );

  return {
    files: new Map([
      ...months.map((m, i): [string, string] => [`${OUT_DIR}/${DAILY_DIR}/${m}.json`, texts[i] ?? '']),
      [`${OUT_DIR}/manifest.json`, `${JSON.stringify(next, null, 2)}\n`],
      [DAILY_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`],
    ]),
    daily,
    log,
  };
}
