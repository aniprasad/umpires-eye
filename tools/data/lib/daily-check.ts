// data:validate's checks on Today's Ten (docs/M2-DESIGN.md §2.9). They read only the files, so they run without the MLB
// cache, and they don't trust data:daily: each rule is checked on its own before check mode reproduces the month files.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { DAILY_RESERVE, isDailyReserve, monthOf, varietyProblems, type DailyDoc } from '../../../src/core/daily.ts';
import { tenProblems } from '../../../src/core/deal.ts';
import { decodeTables, type DecodedTables } from '../../../src/core/decode.ts';
import { CREDIT, SEASON, TRUTH_NOTE } from '../../../src/core/rules.ts';
import { DAILY_FORMAT, FORMAT_VERSION, type ManifestDoc } from '../../../src/core/schema.ts';
import { BOOT_BUDGET_GZIP, MONTH_BUDGET_GZIP, SESSION_BUDGET_GZIP } from './constants.ts';
import { DAILY_DIR, DAILY_REPORT_PATH, datesFrom, generateDaily, isDateKey, readSeason, type Season } from './daily.ts';
import { OUT_DIR } from './pipeline.ts';

export interface DailyFiles {
  manifestText: string;
  statsText: string;
  /** Every shard, by its path in the manifest. */
  shardTexts: ReadonlyMap<string, string>;
  /** Every file in the daily folder, by its path from the season folder. */
  monthTexts: ReadonlyMap<string, string>;
  reportText: string | null;
}

/** Gzipped bytes: a month file; the boot fetch (manifest, the largest month file and stats); and a session, which adds a shard. */
export interface Budgets {
  month: number;
  boot: number;
  session: number;
}

export interface DailyVerdict {
  failures: string[];
  /** Reported, not failed: a served day that no longer keeps the rules stays as it was served. */
  notes: string[];
  monthGzipBytes: Record<string, number>;
  bootGzipBytes: number;
  sessionGzipBytes: number;
}

const gzipBytes = (text: string): number => gzipSync(text).length;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const listed = (ids: readonly string[]): string => `${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ` and ${ids.length - 3} more` : ''}`;

/** A month file's tables against the shards: the same rows, and only the ones its rows reference. */
function tableProblems(file: string, doc: DailyDoc, tables: DecodedTables, season: Season): string[] {
  const problems: string[] = [];
  const pitches = tables.pitches;
  const games = new Set(pitches.map((p) => p.gamePk));
  const venues = new Set(tables.games.flatMap((g) => (g.venue === null ? [] : [g.venue])));
  const umpires = new Set(pitches.flatMap((p) => (p.umpire === null ? [] : [p.umpire])));
  const players = new Set(pitches.flatMap((p) => [p.batter, p.pitcher, ...(p.challenge ? [p.challenge.by] : [])]));
  const types = new Set(pitches.flatMap((p) => (p.type === null ? [] : [p.type])));
  const check = (table: string, rows: readonly unknown[][], wanted: ReadonlySet<number>, shardRow: (id: number) => unknown): void => {
    const at = doc.fields[table as 'games']?.indexOf(table === 'games' ? 'gamePk' : 'id') ?? -1;
    const ids = rows.map((r) => Number(r[at]));

    if (ids.length !== wanted.size || ids.some((id) => !wanted.has(id))) problems.push(`${file}: its ${table} table holds more or other rows than its pitches reference`);
    for (const [k, row] of rows.entries()) {
      if (!same(row, shardRow(ids[k] ?? NaN))) problems.push(`${file}: ${table} row ${ids[k]} differs from the shards'`);
    }
  };

  check('games', doc.games, games, (id) => season.games.get(id)?.row);
  check('venues', doc.venues, venues, (id) => season.venues.get(id));
  check('umpires', doc.umpires, umpires, (id) => season.umpires.get(id));
  check('players', doc.players, players, (id) => season.players.get(id));
  if (!same(Object.keys(doc.pitchTypes).sort(), [...types].sort())) problems.push(`${file}: its pitchTypes hold more or other types than its pitches use`);
  for (const [code, value] of Object.entries(doc.pitchTypes)) {
    if (!same(value, season.pitchTypes[code])) problems.push(`${file}: pitch type ${code} differs from the shards'`);
  }

  return problems;
}

export function checkDaily(files: DailyFiles, budgets: Budgets = { month: MONTH_BUDGET_GZIP, boot: BOOT_BUDGET_GZIP, session: SESSION_BUDGET_GZIP }): DailyVerdict {
  const verdict: DailyVerdict = { failures: [], notes: [], monthGzipBytes: {}, bootGzipBytes: 0, sessionGzipBytes: 0 };
  const fail = (msg: string): void => {
    verdict.failures.push(msg);
  };
  const manifest = JSON.parse(files.manifestText) as ManifestDoc;
  const daily = manifest.daily;
  let season: Season;

  if (!daily) {
    fail('manifest.json has no daily block: run npm run data:daily');

    return verdict;
  }
  try {
    season = readSeason(manifest, files.shardTexts);
  } catch (e) {
    fail(`the shards can't be read together: ${message(e)}`);

    return verdict;
  }

  const horizon = isDateKey(daily.first) && isDateKey(daily.last) && daily.first <= daily.last ? datesFrom(daily.first, daily.last) : [];
  const inHorizon = new Set(horizon);
  const months = [...new Set(horizon.map(monthOf))];
  const reserved = [...season.pitches.values()].filter((c) => c.dealable && isDailyReserve(c.id)).length;
  const unlisted = [...files.monthTexts.keys()].filter((file) => !daily.files.some((meta) => meta.file === file));
  const holder = new Map<string, string>();
  const seen = new Set<string>();

  if (!horizon.length) fail(`the daily block's first and last dates, ${daily.first} and ${daily.last}, aren't a horizon`);
  if (!isDateKey(daily.servedThrough)) fail(`the daily block's servedThrough, ${daily.servedThrough}, isn't a date`);
  if (!same(daily.files.map((f) => f.file), months.map((m) => `${DAILY_DIR}/${m}.json`))) {
    fail(`the daily block lists ${daily.files.map((f) => f.file).join(', ')}, not one file for each month from ${daily.first} to ${daily.last}`);
  }
  if (unlisted.length) fail(`${unlisted.join(', ')} ${unlisted.length > 1 ? 'are' : 'is'} in the daily folder but not in the manifest`);
  if (daily.reserve.share !== DAILY_RESERVE || daily.reserve.pitches !== reserved) {
    fail(`the daily block's reserve, ${JSON.stringify(daily.reserve)}, isn't the shards': ${reserved} dealable pitches at a ${DAILY_RESERVE} share`);
  }

  for (const meta of daily.files) {
    const text = files.monthTexts.get(meta.file);

    if (text === undefined) {
      fail(`${meta.file} is missing`);
      continue;
    }

    const gz = gzipBytes(text);
    const doc = JSON.parse(text) as DailyDoc;
    let tables: DecodedTables;

    verdict.monthGzipBytes[meta.file] = gz;
    if (Buffer.byteLength(text) !== meta.bytes || sha256(text) !== meta.sha256) fail(`${meta.file}: size or hash differs from the manifest`);
    if (gz > budgets.month) fail(`${meta.file}: ${gz} gzipped bytes, over the ${budgets.month}-byte budget for a month file`);
    try {
      // The app's reader: the format, every cell and the references between tables.
      tables = decodeTables(doc, DAILY_FORMAT);
    } catch (e) {
      fail(`${meta.file}: ${message(e)}`);
      continue;
    }
    if (doc.version !== FORMAT_VERSION || doc.season !== SEASON || doc.month !== meta.month) fail(`${meta.file}: wrong format header or month`);
    if (doc.build !== manifest.build) fail(`${meta.file}: build ${doc.build} is not the manifest's ${manifest.build}`);
    if (doc.credit !== CREDIT || doc.truthNote !== TRUTH_NOTE) fail(`${meta.file}: credit or reconstruction note missing`);
    if (!same(doc.fields, manifest.fields)) fail(`${meta.file}: its fields aren't the shards'`);
    for (const msg of tableProblems(meta.file, doc, tables, season)) fail(msg);

    const rowOf = new Map(tables.pitches.map((p, i): [string, unknown] => [p.id, doc.pitches[i]]));
    const shipped = new Set<string>();

    for (const [date, day] of Object.entries(doc.days)) {
      const where = `${meta.file} ${date}`;
      const gone = day.ids.filter((id) => !season.pitches.get(id)?.dealable);

      if (!inHorizon.has(date) || monthOf(date) !== meta.month) fail(`${where}: outside the horizon, or in another month's file`);
      if (seen.has(date)) fail(`${where}: scheduled twice`);
      seen.add(date);
      if (day.ids.length !== 10) fail(`${where}: ${day.ids.length} pitches, not 10`);
      for (const id of day.ids) {
        const other = holder.get(id);

        if (other) fail(`${id} is scheduled on both ${other} and ${date}`);
        if (!isDailyReserve(id)) fail(`${where}: ${id} isn't in the daily reserve`);
        holder.set(id, date);
      }
      if (day.available) {
        const cards = day.ids.flatMap((id) => season.pitches.get(id) ?? []);
        const problems = cards.length === 10 ? [...tenProblems(cards), ...varietyProblems(cards)] : [];

        if (gone.length) fail(`${where}: available, but ${listed(gone)} left the pool or can't be dealt`);
        for (const id of day.ids) {
          shipped.add(id);
          if (!rowOf.has(id)) fail(`${where}: no row for ${id}`);
          else if (!same(rowOf.get(id), season.pitches.get(id)?.row)) fail(`${where}: ${id}'s row differs from its shard's`);
        }
        // A served day stays as everyone played it, so a rule it no longer keeps is reported, not failed (§2.5).
        if (problems.length) (date <= daily.servedThrough ? verdict.notes : verdict.failures).push(`${where}: ${problems.join('; ')}`);
      } else {
        if (date > daily.servedThrough) fail(`${where}: unavailable, but after servedThrough, ${daily.servedThrough}: it should have been dealt again`);
        if (!day.missing.length || !same(day.missing, gone)) {
          fail(`${where}: names ${listed(day.missing) || 'nothing'} as missing, but ${listed(gone) || 'nothing'} left the pool or can't be dealt`);
        }
      }
    }

    const extra = tables.pitches.filter((p) => !shipped.has(p.id)).map((p) => p.id);

    if (extra.length) fail(`${meta.file}: rows for ${listed(extra)}, which no available day holds`);
  }

  const gaps = horizon.filter((d) => !seen.has(d));
  const shardGzip = [...files.shardTexts.values()].map(gzipBytes);

  if (gaps.length) fail(`no ten on ${listed(gaps)}: the dates must run from ${daily.first} to ${daily.last} without gaps`);
  verdict.bootGzipBytes = gzipBytes(files.manifestText) + Math.max(0, ...Object.values(verdict.monthGzipBytes)) + gzipBytes(files.statsText);
  verdict.sessionGzipBytes = verdict.bootGzipBytes + Math.max(0, ...shardGzip);
  if (verdict.bootGzipBytes > budgets.boot) fail(`the boot fetch is ${verdict.bootGzipBytes} gzipped bytes, over the ${budgets.boot}-byte budget`);
  if (verdict.sessionGzipBytes > budgets.session) fail(`a session is ${verdict.sessionGzipBytes} gzipped bytes, over the ${budgets.session}-byte budget`);

  // Check mode: the recorded schedule, with its own servedThrough, reproduces every file byte for byte.
  try {
    const run = generateDaily(files.manifestText, files.shardTexts, files.monthTexts, { today: daily.servedThrough, check: true });

    for (const [rel, text] of run.files) {
      const given =
        rel === `${OUT_DIR}/manifest.json` ? files.manifestText : rel === DAILY_REPORT_PATH ? files.reportText : files.monthTexts.get(rel.slice(OUT_DIR.length + 1));

      if (given !== text) fail(`${rel} isn't what npm run data:daily -- --check reproduces from the recorded schedule`);
    }
  } catch (e) {
    fail(`npm run data:daily -- --check can't reproduce the schedule: ${message(e)}`);
  }

  return verdict;
}
