// npm run data:validate: checks public/data/season-2026 on its own terms (schema, ABS truth recomputed from what is
// stored, dealing, sizes, totals) and, when the cache is present, that a rebuild reproduces every file exactly.
// Pass --no-rebuild to skip the rebuild.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDir, openCache } from './lib/cache.ts';
import { CALIBRATOR_MIN_IN, CLOSE_IN, CREDIT, MAX_FLIGHT_S, NEAR_IN, SEASON, SESSION_BUDGET_GZIP, TRUTH_NOTE } from './lib/constants.ts';
import type { Card } from './lib/deal.ts';
import { decodeGames, decodeNames, decodePitches, type ShardDoc, type StoredPitch } from './lib/decode.ts';
import { FORMAT_VERSION, MANIFEST_FORMAT, SHARD_FORMAT, STATS_FORMAT } from './lib/format.ts';
import { loadInputs } from './lib/inputs.ts';
import { absJudge, crossing, flightTime, inDealBox, TRAJ_KEYS } from './lib/physics.ts';
import { buildDataset, dealingCheck, DEALS_PER_SHARD, OUT_DIR, SEED, sessionSizes, sha256 } from './lib/pipeline.ts';
import { compareGames } from './lib/schedule.ts';
import type { Tally } from './lib/stats.ts';

interface ShardMeta {
  file: string;
  pitches: number;
  dealable: number;
  bytes: number;
  sha256: string;
}

interface Manifest {
  format: string;
  version: number;
  season: number;
  credit: string;
  truthNote: string;
  coverage: { calledPitches: number; challenges: number };
  pool: { pitches: number; dealable: number; close: number; near: number; calibrators: number; challenged: number };
  shards: ShardMeta[];
}

interface Stats {
  format: string;
  version: number;
  season: number;
  credit: string;
  calledPitches: { total: number };
  challenges: { total: number; overturned: number; absAgreesWithFinalCall: Tally };
  umpVsAbs: { overall: Tally; close: Tally };
}

const MARGIN_TOLERANCE_IN = 0.011;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rebuild = !process.argv.includes('--no-rebuild');
const problems: string[] = [];
const fail = (msg: string): void => {
  problems.push(msg);
};
const read = (rel: string): string | null => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);
const isInt = (v: unknown): boolean => Number.isInteger(v);
const inRange = (v: number, lo: number, hi: number): boolean => Number.isInteger(v) && v >= lo && v <= hi;
const kb = (n: number): string => `${(n / 1000).toFixed(0)} KB`;

function pitchProblems(p: StoredPitch, games: Map<number, number>, players: Set<number>, types: Set<string>): string[] {
  const out: string[] = [];
  const role = p.challenge?.role;

  if (![p.gamePk, p.atBat, p.pitch, p.batter, p.pitcher].every(isInt)) out.push('ids are not integers');
  if (!games.has(p.gamePk)) out.push('game missing from the games table');
  if (!players.has(p.batter) || !players.has(p.pitcher)) out.push('batter or pitcher missing from the players table');
  if (p.challenge && !players.has(p.challenge.by)) out.push('challenger missing from the players table');
  if (p.type !== null && !types.has(p.type)) out.push(`pitch type ${p.type} missing from pitchTypes`);
  if (!(p.inning >= 1 && isInt(p.inning)) || !inRange(p.outs, 0, 2)) out.push('bad inning or outs');
  if (!inRange(p.balls, 0, 9) || !inRange(p.strikes, 0, 9)) out.push(`bad count ${p.balls}-${p.strikes}`);
  // A feed scoring error can leave an impossible count; such a pitch may sit in the pool only as an undealable challenge.
  if (p.dealable && (p.balls > 3 || p.strikes > 2)) out.push(`dealable with an impossible count ${p.balls}-${p.strikes}`);
  if (!inRange(p.awayScore, 0, 99) || !inRange(p.homeScore, 0, 99) || !inRange(p.bases, 0, 7)) out.push('bad score or bases');
  if (!['L', 'R'].includes(p.bats) || !['L', 'R'].includes(p.throws)) out.push('bad batter side or pitcher hand');
  if (![p.ump, p.final, p.abs].every((c) => c === 'S' || c === 'B')) out.push('bad call code');
  if (!TRAJ_KEYS.every((k) => Number.isFinite(p.traj[k])) || p.traj.vY0 >= 0) out.push('bad trajectory');
  if (!(p.zoneBottom > 0 && p.zoneTop > p.zoneBottom) || !Number.isFinite(p.marginIn)) out.push('bad zone or margin');
  if (p.challenge === null ? p.ump !== p.final : p.challenge.overturned !== (p.ump !== p.final)) {
    out.push('ump and final calls disagree with the challenge record');
  }
  // Only the batter may challenge a strike, and only the pitcher or catcher a ball.
  if (role && (role === 'B') !== (p.ump === 'S')) out.push(`role ${role} challenged a called ${p.ump}`);

  return out;
}

const manifestText = read(`${OUT_DIR}/manifest.json`);
const statsText = read(`${OUT_DIR}/stats.json`);

if (!manifestText || !statsText) {
  console.error(`No dataset in ${OUT_DIR}. Run npm run data:build.`);
  process.exit(1);
}

const manifest = JSON.parse(manifestText) as Manifest;
const stats = JSON.parse(statsText) as Stats;
const listed = manifest.shards.map((s) => s.file).sort();
const onDisk = readdirSync(join(root, OUT_DIR, 'shards'))
  .map((f) => `shards/${f}`)
  .sort();

for (const [name, doc, format] of [
  ['manifest.json', manifest, MANIFEST_FORMAT],
  ['stats.json', stats, STATS_FORMAT],
] as const) {
  if (doc.format !== format || doc.version !== FORMAT_VERSION || doc.season !== SEASON) fail(`${name}: wrong format header`);
  if (doc.credit !== CREDIT) fail(`${name}: the MLB credit is missing or changed`);
}
if (manifest.truthNote !== TRUTH_NOTE) fail('manifest.json: the reconstruction note is missing or changed');
if (JSON.stringify(listed) !== JSON.stringify(onDisk)) fail(`shards on disk ${onDisk.join(',')} differ from the manifest`);

const ids = new Set<string>();
const texts: string[] = [];
const table: string[] = [];
const totals = { pitches: 0, dealable: 0, close: 0, near: 0, calibrators: 0, challenged: 0, agree: 0, overturned: 0 };
let maxDrift = 0;
let heldBack = 0;
let slowestDealable = 0;
let noUmpirePitches = 0;
const noUmpire = new Set<number>();

for (const meta of manifest.shards) {
  const text = read(`${OUT_DIR}/${meta.file}`);

  if (text === null) {
    fail(`${meta.file} is missing`);
    continue;
  }
  texts.push(text);
  if (Buffer.byteLength(text) !== meta.bytes || sha256(text) !== meta.sha256) fail(`${meta.file}: size or hash differs from the manifest`);

  const doc = JSON.parse(text) as ShardDoc;
  const games = decodeGames(doc);
  const venues = decodeNames(doc, 'venues');
  const umpires = decodeNames(doc, 'umpires');
  const gameOrder = new Map(games.map((g, i) => [g.gamePk, i]));
  const players = new Set(doc.players.map((r) => r[0] as number));
  const types = new Set(Object.keys(doc.pitchTypes));
  const pitches = decodePitches(doc);
  const cards: Card[] = [];
  let prev: [number, number, number] = [-1, -1, -1];

  if (doc.format !== SHARD_FORMAT || doc.version !== FORMAT_VERSION || doc.season !== SEASON) fail(`${meta.file}: wrong format header`);
  if (doc.credit !== CREDIT || doc.truthNote !== TRUTH_NOTE) fail(`${meta.file}: credit or reconstruction note missing`);
  if (doc.shards !== manifest.shards.length || pitches.length !== meta.pitches) fail(`${meta.file}: counts differ from the manifest`);
  for (const [k, g] of games.entries()) {
    const before = games[k - 1];

    if (before && compareGames(before, g) >= 0) fail(`${meta.file}: games table out of order at ${g.gamePk}`);
    if (g.venue !== null && !venues.has(g.venue)) fail(`${meta.file}: game ${g.gamePk} names a venue missing from its table`);
  }
  for (const [id, name] of umpires) {
    if (!name || name.trim().toLowerCase() === 'no umpire') fail(`${meta.file}: umpire ${id} has no real name`);
  }

  for (const [k, p] of pitches.entries()) {
    const where = `${meta.file} ${p.id}`;
    const mid = crossing(p.traj);
    const judged = absJudge(mid.x, mid.z, p.zoneTop, p.zoneBottom);
    const boxed = inDealBox(mid) && p.extension !== null && p.mph !== null;
    const flight = p.extension === null ? null : flightTime(p.traj, p.extension);
    const drawable = boxed && flight !== null && flight <= MAX_FLIGHT_S;
    const m = Math.abs(p.marginIn);
    const key: [number, number, number] = [gameOrder.get(p.gamePk) ?? -1, p.atBat, p.pitch];

    for (const msg of pitchProblems(p, gameOrder, players, types)) fail(`${where}: ${msg}`);
    if (p.umpire === null) {
      noUmpire.add(p.gamePk);
      noUmpirePitches++;
    } else if (!umpires.has(p.umpire)) {
      fail(`${where}: plate umpire ${p.umpire} missing from the umpires table`);
    }
    if (ids.has(p.id)) fail(`${where}: appears twice`);
    ids.add(p.id);
    if (key[0] < prev[0] || (key[0] === prev[0] && (key[1] < prev[1] || (key[1] === prev[1] && key[2] <= prev[2])))) {
      fail(`${where}: out of played order`);
    }
    prev = key;
    if (judged.strike !== (p.abs === 'S')) fail(`${where}: stored ABS call differs from the one recomputed from the stored trajectory`);
    maxDrift = Math.max(maxDrift, Math.abs(judged.marginIn - p.marginIn));
    if (Math.abs(judged.marginIn - p.marginIn) > MARGIN_TOLERANCE_IN) fail(`${where}: margin drifts ${judged.marginIn} vs ${p.marginIn}`);
    if (p.dealable && !boxed) fail(`${where}: dealable but outside the crossing box or missing release data`);
    if (p.dealable && flight !== null) {
      slowestDealable = Math.max(slowestDealable, flight);
      if (flight > MAX_FLIGHT_S) fail(`${where}: dealable but ${flight.toFixed(3)} s from release to the plate`);
    }
    if (!p.dealable && drawable) heldBack++;
    if (!p.challenge && !(p.dealable && (m <= NEAR_IN || m >= CALIBRATOR_MIN_IN))) fail(`${where}: does not belong in the pool`);

    totals.pitches++;
    if (p.dealable) {
      totals.dealable++;
      cards.push({ id: p.id, seq: k, absMarginIn: m, challenged: p.challenge !== null });
      if (m <= CLOSE_IN) totals.close++;
      else if (m <= NEAR_IN) totals.near++;
    }
    if (!p.challenge && m >= CALIBRATOR_MIN_IN) totals.calibrators++;
    if (p.challenge) {
      totals.challenged++;
      if (p.abs === p.final) totals.agree++;
      if (p.challenge.overturned) totals.overturned++;
    }
  }

  const deal = dealingCheck(cards, `${SEED}|validate|${meta.file}`, DEALS_PER_SHARD);

  for (const msg of deal.problems.slice(0, 3)) fail(`${meta.file}: ${msg}`);
  table.push(
    `  ${meta.file}  ${String(pitches.length).padStart(5)} pitches, ${String(deal.close).padStart(4)} close (${deal.closeChallenged} challenged), ${String(deal.near).padStart(4)} near, ${String(deal.calibrators).padStart(4)} calibrators, ${kb(meta.bytes)}`,
  );
}

const sizes = sessionSizes(manifestText, statsText, texts);
const pool = manifest.pool;

if (sizes.largestSessionGzipBytes > SESSION_BUDGET_GZIP) fail(`a play session downloads ${sizes.largestSessionGzipBytes} gzipped bytes`);
if (
  totals.pitches !== pool.pitches ||
  totals.dealable !== pool.dealable ||
  totals.close !== pool.close ||
  totals.near !== pool.near ||
  totals.calibrators !== pool.calibrators ||
  totals.challenged !== pool.challenged
) {
  fail(`pool composition differs from the manifest: ${JSON.stringify(totals)}`);
}
if (totals.challenged !== stats.challenges.total || totals.overturned !== stats.challenges.overturned) {
  fail('stats.json challenge totals differ from the shards (every challenged pitch should be in the pool)');
}
if (totals.agree !== stats.challenges.absAgreesWithFinalCall.agree) fail('stats.json challenge agreement differs from the shards');
if (stats.umpVsAbs.overall.total !== stats.calledPitches.total || manifest.coverage.calledPitches !== stats.calledPitches.total) {
  fail('called-pitch totals disagree between manifest.json and stats.json');
}

console.log(table.join('\n'));
console.log(
  `per shard gzipped: ${sizes.shardGzipBytes.map(kb).join(', ')}; manifest ${kb(sizes.manifestGzipBytes)}, stats ${kb(sizes.statsGzipBytes)}`,
);
console.log(`largest play session: ${kb(sizes.largestSessionGzipBytes)} gzipped (budget ${kb(SESSION_BUDGET_GZIP)})`);
console.log(
  `challenges: ABS reconstruction = final call on ${totals.agree}/${totals.challenged}; max stored-margin drift ${maxDrift.toFixed(4)} in; ${heldBack} drawable pitches held back (uncertain batter or pitcher, or an impossible count)`,
);
console.log(`slowest dealable pitch: ${slowestDealable.toFixed(3)} s from release to the plate (limit ${MAX_FLIGHT_S} s)`);
console.log(`pitches in the shards without a plate umpire: ${noUmpirePitches}, in games ${[...noUmpire].sort((a, b) => a - b).join(', ') || 'none'}`);

if (rebuild) {
  const inputs = loadInputs(openCache(cacheDir()));

  if (!inputs) {
    console.log('rebuild check skipped: the MLB Stats API cache is empty (run npm run data:fetch to enable it)');
  } else {
    console.log('rebuilding from the cache to check the files are reproducible ...');

    const rebuilt = buildDataset(inputs);

    for (const [rel, text] of rebuilt.files) {
      if (read(rel) !== text) fail(`${rel} differs from a fresh rebuild`);
    }
    console.log(`rebuild check: ${rebuilt.files.size} files compared`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problems:\n  ${problems.slice(0, 40).join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log('\ndataset OK');
}
