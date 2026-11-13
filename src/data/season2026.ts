// The 2026 season (docs/M2-DESIGN.md §4): Today's Ten from a month file, Another ten from a shard, and the ump figure
// from stats.json. Nothing loads before the game asks: today() reads the manifest and one month file, the first deck()
// one shard, and umpFigure() the stats.
import { isDailyReserve, monthOf, type DailyDay, type DailyFileMeta, type ManifestDaily } from '../core/daily.ts';
import { DecodeError, decodeTables, type DecodedTables } from '../core/decode.ts';
import type { Rand } from '../core/rng.ts';
import { DAILY_FORMAT, FORMAT_VERSION, MANIFEST_FORMAT, SHARD_FORMAT, STATS_FORMAT, type ShardFileMeta, type StoredPitch } from '../core/schema.ts';
import type { Pitch } from '../math/types';
import { boxLensPoints, rowReader, type RowReader } from './adapter';
import { isDateKey, monthLabel } from './dates';
import { fetchJson, matchBuild, versioned, type Built, type Net } from './fetch';
import { LoadError, type Deck, type PitchSource, type TodayResult, type UmpFigure } from './source';

export const SEASON_LABEL = '2026 season';

const MANIFEST = 'the season manifest';
const STATS = 'the season stats';
const MORE = 'the pitches for Another ten';

type MonthMeta = Pick<DailyFileMeta, 'month' | 'file'>;
type ShardMeta = Pick<ShardFileMeta, 'file' | 'sha256'>;

/** What the app reads from manifest.json. */
interface Manifest extends Built {
  readonly daily: Pick<ManifestDaily, 'first' | 'last'> & { readonly files: readonly MonthMeta[] };
  readonly shards: readonly ShardMeta[];
}

/** A decoded shard or month file. */
interface Rows extends Built {
  readonly tables: DecodedTables;
  readonly reader: RowReader;
}

interface MonthFile extends Rows {
  readonly days: Readonly<Record<string, unknown>>;
  readonly byId: ReadonlyMap<string, StoredPitch>;
}

interface Stats extends Built {
  readonly season: number;
  readonly pct: number;
}

type Doc = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string => (v === undefined ? 'missing' : JSON.stringify(v));
const broken = (what: string, why: string): LoadError => new LoadError('data', `${what[0]?.toUpperCase()}${what.slice(1)} ${why}.`);
const isMonthMeta = (v: unknown): v is MonthMeta => isRecord(v) && typeof v.month === 'string' && typeof v.file === 'string';
// the shard's ?v= is the first 12 hex digits of its sha256
const isShardMeta = (v: unknown): v is ShardMeta => isRecord(v) && typeof v.file === 'string' && typeof v.sha256 === 'string' && /^[0-9a-f]{12,}$/.test(v.sha256);

function readManifest(body: unknown): Manifest {
  const d: Doc = isRecord(body) ? body : {};
  const daily = isRecord(d.daily) ? d.daily : null;

  if (d.format !== MANIFEST_FORMAT || d.version !== FORMAT_VERSION) {
    throw broken(MANIFEST, `is ${show(d.format)} version ${show(d.version)}, not ${MANIFEST_FORMAT} version ${FORMAT_VERSION}`);
  }
  if (typeof d.build !== 'string' || d.build === '') throw broken(MANIFEST, 'has no build id');
  // data:build writes a manifest without one; only data:daily adds the schedule
  if (!daily) throw broken(MANIFEST, 'has no daily block, so there is no schedule to read');
  const { first, last, files } = daily;

  if (typeof first !== 'string' || typeof last !== 'string' || !isDateKey(first) || !isDateKey(last) || !Array.isArray(files) || !files.every(isMonthMeta)) {
    throw broken(MANIFEST, 'has a daily block without its dates or its month files');
  }
  if (!Array.isArray(d.shards) || d.shards.length === 0 || !d.shards.every(isShardMeta)) throw broken(MANIFEST, 'lists no shards it can name');

  return { build: d.build, daily: { first, last, files }, shards: d.shards };
}

function readRows(body: unknown, format: string, what: string): Rows & { readonly doc: Doc } {
  let tables: DecodedTables;

  try {
    tables = decodeTables(body, format);
  } catch (e) {
    if (e instanceof DecodeError) throw broken(what, `doesn't add up: ${e.message}`);
    throw e;
  }
  // decodeTables has checked that the body is an object
  const doc = body as Doc;

  if (typeof doc.build !== 'string' || typeof doc.season !== 'number') throw broken(what, 'has no build id or no season');

  return { doc, build: doc.build, tables, reader: rowReader(tables, doc.season) };
}

function readMonth(body: unknown, what: string): MonthFile {
  const rows = readRows(body, DAILY_FORMAT, what);

  if (!isRecord(rows.doc.days)) throw broken(what, 'has no days');

  return { ...rows, days: rows.doc.days, byId: new Map(rows.tables.pitches.map((p) => [p.id, p])) };
}

function readStats(body: unknown): Stats {
  const d: Doc = isRecord(body) ? body : {};
  const overall: Doc = isRecord(d.umpVsAbs) && isRecord(d.umpVsAbs.overall) ? d.umpVsAbs.overall : {};

  if (d.format !== STATS_FORMAT || d.version !== FORMAT_VERSION) throw broken(STATS, `are ${show(d.format)} version ${show(d.version)}, not ${STATS_FORMAT} version ${FORMAT_VERSION}`);
  if (typeof d.build !== 'string' || typeof d.season !== 'number' || typeof overall.pct !== 'number' || !Number.isFinite(overall.pct)) {
    throw broken(STATS, 'have no build id, season or overall agreement');
  }

  return { build: d.build, season: d.season, pct: overall.pct };
}

function dayOf(month: MonthFile, dateKey: string, what: string): DailyDay | undefined {
  const day = month.days[dateKey];

  if (day === undefined) return undefined;
  if (!isRecord(day) || typeof day.available !== 'boolean' || !Array.isArray(day.ids) || !day.ids.every((id) => typeof id === 'string')) {
    throw broken(what, `has a malformed entry for ${dateKey}`);
  }

  return day as DailyDay;
}

/** One load for everyone who asks while it runs. A failed one is dropped, so the next ask tries again. */
function shared<T>(load: (signal?: AbortSignal) => Promise<T>): (signal?: AbortSignal) => Promise<T> {
  let running: Promise<T> | null = null;

  return (signal) => {
    if (!running) {
      const p = load(signal);

      running = p;
      p.catch(() => {
        if (running === p) running = null;
      });
    }

    return running;
  };
}

export interface SeasonOptions {
  /** The dataset's folder, ending in a slash: "<base>data/season-2026/". */
  readonly root: string;
  readonly net?: Net;
  /** Picks the shard Another ten deals from. */
  readonly rand?: Rand;
}

/** The season source. It's ready at once: its lens is the deal box, and its files load when the game asks for them. */
export function seasonSource({ root, net, rand = Math.random }: SeasonOptions): PitchSource {
  let manifest: Promise<Manifest> | null = null;
  const months = new Map<string, (signal?: AbortSignal) => Promise<MonthFile>>();
  const get = (file: string, what: string, cache: RequestCache, signal?: AbortSignal): Promise<unknown> => fetchJson(root + file, { what, cache, signal, net });
  const fetchManifest = async (cache: RequestCache, signal?: AbortSignal): Promise<Manifest> => readManifest(await get('manifest.json', MANIFEST, cache, signal));
  // The manifest the page goes by, until a build check brings a newer one.
  const theManifest = (signal?: AbortSignal): Promise<Manifest> => {
    manifest ??= fetchManifest('no-cache', signal).catch((e: unknown) => {
      manifest = null;
      throw e;
    });

    return manifest;
  };

  /** A file, paired with the manifest of its build (§4.3). */
  async function sameBuild<F extends Built>(file: F, refetch: (fresh: Manifest) => Promise<F>, what: string, signal?: AbortSignal): Promise<F> {
    const known = await theManifest(signal);
    const got = await matchBuild(known, file, { manifest: () => fetchManifest('reload', signal), file: refetch }, what);

    if (got.manifest !== known) manifest = Promise.resolve(got.manifest);

    return got.file;
  }

  async function loadMonth(month: string, signal?: AbortSignal): Promise<MonthFile> {
    const meta = (await theManifest(signal)).daily.files.find((f) => f.month === month);
    const what = `the pitches for ${monthLabel(month)}`;
    const read = async (file: string): Promise<MonthFile> => readMonth(await get(file, what, 'no-cache', signal), what);

    if (!meta) throw broken(MANIFEST, `lists no month file for ${month}, though its schedule covers it`);

    return sameBuild(await read(meta.file), (fresh) => read(versioned(meta.file, fresh.build)), what, signal);
  }

  function monthFile(month: string, signal?: AbortSignal): Promise<MonthFile> {
    let load = months.get(month);

    if (!load) {
      load = shared((s) => loadMonth(month, s));
      months.set(month, load);
    }

    return load(signal);
  }

  async function today(dateKey: string, signal?: AbortSignal): Promise<TodayResult> {
    const { daily } = await theManifest(signal);

    // the manifest decides: past the schedule's ends, no month file is read (§4.1)
    if (dateKey < daily.first || dateKey > daily.last) return { kind: 'none', dateKey, reason: 'outside-horizon' };
    const what = `the pitches for ${monthLabel(monthOf(dateKey))}`;
    const month = await monthFile(monthOf(dateKey), signal);
    const day = dayOf(month, dateKey, what);

    if (!day) throw broken(what, `have no entry for ${dateKey}, though the schedule runs from ${daily.first} to ${daily.last}`);
    if (!day.available) return { kind: 'none', dateKey, reason: 'unavailable' };
    const pitches = day.ids.map((id, i): Pitch => {
      const row = month.byId.get(id);

      if (!row) throw broken(what, `have no row for ${id}, one of the ten for ${dateKey}`);

      // in play order, calibrator first
      return month.reader.pitch(row, i);
    });

    return { kind: 'ten', dateKey, pitches };
  }

  const deck = shared(async (signal): Promise<Deck> => {
    const { shards } = await theManifest(signal);
    // T10 makes this one shard per page, and adds the next when a deck runs dry
    const at = Math.floor(rand() * shards.length);
    const read = async (meta: ShardMeta): Promise<Rows> => readRows(await get(versioned(meta.file, meta.sha256.slice(0, 12)), MORE, 'force-cache', signal), SHARD_FORMAT, MORE);
    const rows = await sameBuild(await read(shards[at]), (fresh) => {
      const meta = fresh.shards[at];

      return meta ? read(meta) : Promise.reject(broken(MANIFEST, `no longer lists shard ${at}`));
    }, MORE, signal);
    // dealable rows only, in the file's played order, and none held back for Today's Ten
    const pitches = rows.tables.pitches.flatMap((row, i) => (row.dealable && !isDailyReserve(row.id) ? [rows.reader.pitch(row, i)] : []));

    return { pitches, next: () => Promise.resolve(null) };
  });

  const figure = shared(async (): Promise<UmpFigure> => {
    const read = async (file: string): Promise<Stats> => readStats(await get(file, STATS, 'no-cache'));
    const stats = await sameBuild(await read('stats.json'), (fresh) => read(versioned('stats.json', fresh.build)), STATS);

    return {
      pct: Math.round(stats.pct * 10) / 10,
      label: 'season overall',
      definition: `Agreement with our ABS reconstruction on ${stats.season} called pitches.`,
      approx: false,
    };
  });

  return {
    id: 'season-2026',
    label: SEASON_LABEL,
    lensPoints: boxLensPoints(),
    today,
    deck,
    // play never waits for the stats: without them, the copy leaves the figure out (§5.4)
    umpFigure: () => figure().catch(() => null),
  };
}
