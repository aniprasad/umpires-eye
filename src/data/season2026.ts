// The 2026 season (docs/M2-DESIGN.md §4): Today's Ten from a month file, Another ten from a shard, and the ump figure
// from stats.json. Nothing loads before the game asks: today() reads the manifest and one month file, prefetch() the
// text of one shard, the first deck() parses it, and umpFigure() reads the stats.
import { isDailyReserve, monthOf, type DailyDay } from '../core/daily.ts';
import { DecodeError, decodeTables, type DecodedTables } from '../core/decode.ts';
import type { Rand } from '../core/rng.ts';
import { DAILY_FORMAT, FORMAT_VERSION, MANIFEST_FORMAT, SHARD_FORMAT, STATS_FORMAT, type ManifestDoc, type StoredPitch } from '../core/schema.ts';
import type { Pitch } from '../math/types';
import { boxLensPoints, rowReader, type RowReader } from './adapter';
import { isDateKey, monthLabel } from './dates';
import { fetchJson, fetchText, matchBuild, parseJson, versioned, type Built, type Net } from './fetch';
import { LoadError, type Deck, type PitchSource, type TodayResult, type UmpFigure } from './source';

export const SEASON_LABEL = '2026 season';

const MANIFEST = 'the season manifest';
const STATS = 'the season stats';
const MORE = 'the pitches for Another ten';

type Schedule = NonNullable<ManifestDoc['daily']>;
type MonthMeta = Pick<Schedule['files'][number], 'month' | 'file'>;
type ShardMeta = Pick<ManifestDoc['shards'][number], 'file' | 'sha256'>;

/** What the app reads from manifest.json: core's ManifestDoc, cut down to the build, the schedule and the shards. */
interface Manifest extends Pick<ManifestDoc, 'build'> {
  readonly daily: Pick<Schedule, 'first' | 'last'> & { readonly files: readonly MonthMeta[] };
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
    if (e instanceof DecodeError) throw broken(what, `didn't add up: ${e.message}`);
    throw e;
  }
  // decodeTables has checked that the body is an object
  const doc = body as Doc;

  if (typeof doc.build !== 'string' || typeof doc.season !== 'number') throw broken(what, 'came without a build id or a season');

  return { doc, build: doc.build, tables, reader: rowReader(tables, doc.season) };
}

function readMonth(body: unknown, what: string): MonthFile {
  const rows = readRows(body, DAILY_FORMAT, what);

  if (!isRecord(rows.doc.days)) throw broken(what, 'came without their days');

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
    throw broken(what, `came with a malformed entry for ${dateKey}`);
  }

  return day as DailyDay;
}

/**
 * Waits for a load the page shares, or rejects with the signal's reason once this caller stops waiting. The load runs on
 * for anyone else waiting, and for the next caller.
 */
function abortable<T>(load: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return load;
  if (signal.aborted) return Promise.reject(signal.reason as unknown);

  return new Promise<T>((resolve, reject) => {
    const stop = (): void => reject(signal.reason as unknown);

    signal.addEventListener('abort', stop, { once: true });
    void load.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/**
 * One load for everyone who asks while it runs. No caller's signal reaches it, so one caller giving up can't fail the
 * others. A failed load is dropped, so the next ask tries again.
 */
function shared<T>(load: () => Promise<T>): (signal?: AbortSignal) => Promise<T> {
  let running: Promise<T> | null = null;

  return (signal) => {
    if (!running) {
      const p = load();

      running = p;
      p.catch(() => {
        if (running === p) running = null;
      });
    }

    return abortable(running, signal);
  };
}

export interface SeasonOptions {
  /** The dataset's folder, ending in a slash: "<base>data/season-2026/". */
  readonly root: string;
  readonly net?: Net;
  /** Picks the shards Another ten deals from. */
  readonly rand?: Rand;
}

/** The season source. It's ready at once: its lens is the deal box, and its files load when the game asks for them. */
export function seasonSource({ root, net, rand = Math.random }: SeasonOptions): PitchSource {
  let manifest: Promise<Manifest> | null = null;
  // Whether a manifest has arrived. A date asked for after that checks it for a new build; one in flight is fresh.
  let arrived = false;
  const months = new Map<string, (signal?: AbortSignal) => Promise<MonthFile>>();
  // The shards this page has dealt from, or is about to. Another ten never goes back to one (§3).
  const used = new Set<number>();
  const texts = new Map<number, (signal?: AbortSignal) => Promise<string>>();
  // Loads are shared, so none takes a caller's signal (shared() above).
  const get = (file: string, what: string, cache: RequestCache): Promise<unknown> => fetchJson(root + file, { what, cache, net });
  const fetchManifest = async (cache: RequestCache): Promise<Manifest> => readManifest(await get('manifest.json', MANIFEST, cache));
  // The manifest the page goes by, until a build check brings a newer one.
  const theManifest = (signal?: AbortSignal): Promise<Manifest> => {
    manifest ??= fetchManifest('no-cache').then(
      (m) => {
        arrived = true;

        return m;
      },
      (e: unknown) => {
        manifest = null;
        throw e;
      },
    );

    return abortable(manifest, signal);
  };

  /** A file, paired with the manifest of its build (§4.3). */
  async function sameBuild<F extends Built>(file: F, refetch: (fresh: Manifest) => Promise<F>, what: string): Promise<F> {
    const known = await theManifest();
    const got = await matchBuild(known, file, { manifest: () => fetchManifest('reload'), file: refetch }, what);

    if (got.manifest !== known) manifest = Promise.resolve(got.manifest);

    return got.file;
  }

  /**
   * A tab can stay open across a deploy, so a date asked for once the manifest has arrived asks for it again (§2.2).
   * It's no-cache: an unchanged one costs a 304. A new build replaces the old manifest and drops the month files
   * matched to it. Without an answer, the manifest the page has still serves the dates it has month files for; only a
   * manifest this page can't read stops it.
   */
  async function revalidate(known: Promise<Manifest>, signal?: AbortSignal): Promise<void> {
    let fresh: Manifest;

    try {
      fresh = await abortable(fetchManifest('no-cache'), signal);
    } catch (e) {
      if (e instanceof LoadError && e.kind !== 'data') return;
      throw e;
    }
    const was = await known;

    // a build check elsewhere may have brought a newer manifest meanwhile; it stands
    if (manifest !== known || fresh.build === was.build) return;
    manifest = Promise.resolve(fresh);
    months.clear();
  }

  async function loadMonth(month: string): Promise<MonthFile> {
    const what = `the pitches for ${monthLabel(month)}`;
    const read = async (file: string): Promise<MonthFile> => readMonth(await get(file, what, 'no-cache'), what);
    // data:daily names a month file by its month (DATA.md), so it loads alongside the manifest rather than after it
    const guess = `daily/${month}.json`;
    const early = read(guess);

    early.catch(() => undefined);
    const meta = (await theManifest()).daily.files.find((f) => f.month === month);

    if (!meta) throw broken(MANIFEST, `lists no month file for ${month}, though its schedule covers it`);

    return sameBuild(meta.file === guess ? await early : await read(meta.file), (fresh) => read(versioned(meta.file, fresh.build)), what);
  }

  function monthFile(month: string, signal?: AbortSignal): Promise<MonthFile> {
    let load = months.get(month);

    if (!load) {
      load = shared(() => loadMonth(month));
      months.set(month, load);
    }

    return load(signal);
  }

  async function today(dateKey: string, signal?: AbortSignal): Promise<TodayResult> {
    const month = monthOf(dateKey);

    if (arrived && manifest) await revalidate(manifest, signal);
    const known = theManifest(signal);

    // The month file loads alongside the manifest (§4.1), but the manifest decides: past the schedule's ends, the month
    // file's answer is ignored, errors included.
    monthFile(month).catch(() => undefined);
    const { daily } = await known;

    if (dateKey < daily.first || dateKey > daily.last) return { kind: 'none', dateKey, reason: 'outside-horizon' };
    const what = `the pitches for ${monthLabel(month)}`;
    const file = await monthFile(month, signal);
    const day = dayOf(file, dateKey, what);

    if (!day) throw broken(what, `have no entry for ${dateKey}, though the schedule runs from ${daily.first} to ${daily.last}`);
    if (!day.available) return { kind: 'none', dateKey, reason: 'unavailable' };
    const pitches = day.ids.map((id, i): Pitch => {
      const row = file.byId.get(id);

      if (!row) throw broken(what, `have no row for ${id}, one of the ten for ${dateKey}`);

      // in play order, calibrator first
      return file.reader.pitch(row, i);
    });

    return { kind: 'ten', dateKey, pitches };
  }

  /** A shard this page hasn't used, at random, now marked used; null once every one has been. */
  async function unusedShard(): Promise<number | null> {
    const free = (await theManifest()).shards.map((_, at) => at).filter((at) => !used.has(at));
    const at = free[Math.floor(rand() * free.length)];

    if (at === undefined) return null;
    used.add(at);

    return at;
  }

  // Picked once, by prefetch() or the first deck(), whichever asks first.
  const firstShard = shared(async (): Promise<number> => {
    const at = await unusedShard();

    // readManifest refuses a manifest without shards, and nothing is used before this pick
    if (at === null) throw broken(MANIFEST, 'lists no shards');

    return at;
  });

  const metaOf = (m: Manifest, at: number): ShardMeta => {
    const meta = m.shards[at];

    if (!meta) throw broken(MANIFEST, `no longer lists shard ${at}`);

    return meta;
  };
  const shardText = (meta: ShardMeta): Promise<string> =>
    fetchText(root + versioned(meta.file, meta.sha256.slice(0, 12)), { what: MORE, cache: 'force-cache', net });

  /** A shard's text, loaded once for prefetch() and deck() both. A failed load is dropped, so the next ask tries again. */
  function textOf(at: number): (signal?: AbortSignal) => Promise<string> {
    let load = texts.get(at);

    if (!load) {
      load = shared(async () => shardText(metaOf(await theManifest(), at)));
      texts.set(at, load);
    }

    return load;
  }

  /** The deck from one shard: its text parsed, matched to the manifest's build, and cut to what Another ten may deal. */
  async function shardDeck(at: number): Promise<Deck> {
    const read = (text: string): Rows => readRows(parseJson(text, MORE), SHARD_FORMAT, MORE);
    const rows = await sameBuild(read(await textOf(at)()), async (fresh) => read(await shardText(metaOf(fresh, at))), MORE);
    // dealable rows only, in the file's played order, and none held back for Today's Ten
    const pitches = rows.tables.pitches.flatMap((row, i) => (row.dealable && !isDailyReserve(row.id) ? [rows.reader.pitch(row, i)] : []));
    // chosen once, so a next deck that fails to load is tried again from the same shard
    let nextAt: number | null | undefined;
    const next = shared(async (): Promise<Deck | null> => {
      nextAt ??= await unusedShard();

      return nextAt === null ? null : shardDeck(nextAt);
    });

    return { pitches, next };
  }

  const deck = shared(async (): Promise<Deck> => shardDeck(await firstShard()));

  // A failed load is only dropped here: deck() asks for it again.
  const prefetch = (): void => void firstShard().then((at) => textOf(at)()).catch(() => undefined);

  const figure = shared(async (): Promise<UmpFigure> => {
    const read = async (file: string): Promise<Stats> => readStats(await get(file, STATS, 'no-cache'));
    const stats = await sameBuild(await read('stats.json'), (fresh) => read(versioned('stats.json', fresh.build)), STATS);

    return {
      pct: Math.round(stats.pct * 10) / 10,
      label: 'season overall',
      definition: `agreement with our ABS reconstruction on ${stats.season} called pitches`,
      approx: false,
    };
  });

  return {
    id: 'season-2026',
    label: SEASON_LABEL,
    lensPoints: boxLensPoints(),
    today,
    prefetch,
    deck,
    // play never waits for the stats: without them, the copy leaves the figure out (§5.4)
    umpFigure: () => figure().catch(() => null),
  };
}
