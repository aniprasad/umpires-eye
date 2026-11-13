import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { absJudge } from '../../../src/core/abs.ts';
import { dealTen, pilesOf, tenProblems, type Card } from '../../../src/core/deal.ts';
import { crossing } from '../../../src/core/kinematics.ts';
import { hash32, mulberry32 } from '../../../src/core/rng.ts';
import {
  BALL_RADIUS_IN,
  CALIBRATOR_MIN_IN,
  CLOSE_IN,
  CREDIT,
  DEAL_BOX,
  MAX_FLIGHT_S,
  MID_Y,
  NEAR_IN,
  PLATE_FRONT_Y,
  PLATE_HALF_IN,
  RUBBER_Y,
  SEASON,
  SEED,
  TRUTH_NOTE,
} from '../../../src/core/rules.ts';
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
  type ManifestDoc,
  type Row,
  type StatsDoc,
} from '../../../src/core/schema.ts';
import { GAME_TYPE_NAMES, GAME_TYPES, SESSION_BUDGET_GZIP } from './constants.ts';
import { familyOf, gameRow, pitchRow, quantize, round, rowsJson, type Quantized } from './format.ts';
import { countPossible, judge, type Judged } from './judge.ts';
import { ALLOWED, FAILING_KINDS, judgeFindings, type FailingKind } from './integrity.ts';
import type { PlayByPlay, ScheduleResponse, TeamsResponse } from './mlb.ts';
import type { Person } from './people.ts';
import { addChecks, emptyChecks, extractGame, type Checks } from './plays.ts';
import { band, makeShards, PER_CLOSE, selectPool, storedAbsMargin, type PoolEntry } from './pool.ts';
import { parseSchedule, parseTeams, type Game, type Named } from './schedule.ts';
import {
  byGameType,
  challengeMismatches,
  challengeStats,
  pxpzResiduals,
  releaseSides,
  umpVsAbs,
  variants,
  zoneChecks,
} from './stats.ts';
import { plateChanged, plateRuns, type PlateTrack, type Reading } from './umpires.ts';

export const OUT_DIR = 'public/data/season-2026';
export const REPORT_PATH = 'tools/data/reports/season-2026.json';
export const DEALS_PER_SHARD = 200;
// Shard count comes from a fixed size, not from measured gzip bytes, because gzip output differs between zlib builds and
// the files must rebuild identically anywhere. The build fails if the largest session would exceed the budget.
export const PITCHES_PER_SHARD = 3500;

const SAMPLE = 25;

export interface Inputs {
  teams: TeamsResponse;
  schedules: ScheduleResponse[];
  people: Map<number, Person>;
  loadPlays: (gamePk: number) => PlayByPlay | null;
  log?: (line: string) => void;
}

export interface BuildResult {
  files: Map<string, string>;
  summary: string[];
  sizes: SessionSizes;
}

export interface SessionSizes {
  shardBytes: number[];
  shardGzipBytes: number[];
  manifestGzipBytes: number;
  statsGzipBytes: number;
  largestSessionGzipBytes: number;
}

interface DealCard extends Card {
  dealable: boolean;
}

export const gzipBytes = (text: string): number => gzipSync(text).length;
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const pretty = (doc: unknown): string => `${JSON.stringify(doc, null, 2)}\n`;

function mostCommon(counts: Map<string, number>): string {
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '';
}

function cardOf(e: PoolEntry): DealCard {
  return {
    id: e.j.p.id,
    seq: e.j.seq,
    absMarginIn: storedAbsMargin(e.j),
    challenged: e.j.p.challenge !== null,
    dealable: e.dealable,
  };
}

export function dealingCheck(cards: readonly Card[], seed: string, deals: number) {
  const piles = pilesOf(cards);
  const rand = mulberry32(hash32(seed));
  const problems: string[] = [];

  for (let k = 0; k < deals; k++) {
    const ten = dealTen(piles, rand);
    const found = ten ? tenProblems(ten) : ['not enough pitches'];

    for (const p of found) problems.push(`deal ${k}: ${p}`);
  }

  return {
    calibrators: piles.calibrators.length,
    close: piles.close.length,
    closeChallenged: piles.closeChallenged.length,
    near: piles.near.length,
    deals,
    problems,
  };
}

function sample(list: readonly string[]): { count: number; first: string[] } {
  return { count: list.length, first: list.slice(0, SAMPLE) };
}

const READINGS: Record<Reading, string> = {
  'takes-plate': 'moves to the plate',
  'leaves-plate': 'the plate umpire moves to a base, so no one is named until someone takes the plate',
  'replaces-plate': 'replaces the plate umpire',
  'vacates-plate': 'the plate umpire leaves, so no one is named until someone takes the plate',
  'former-slot': 'names an umpire who took the plate earlier in the play, so it fills his former slot and the plate is unchanged',
  conflict: 'contradicts the plate umpire on record, so no one is named for the game up to here',
  base: 'a change among the base umpires; the plate is unchanged',
  unreadable: 'not a form the build reads; the build fails',
};

const paAt = (atBat: number, afterPitch: number): string =>
  atBat < 0 ? 'start' : `PA ${atBat}${afterPitch ? ` after pitch ${afterPitch}` : ''}`;

// Everything that fails the build unless pinned in the allowlist. Dealable here means dealable over the whole season,
// before the pool samples it.
export function integrityFindings(all: readonly Judged[], checks: Checks, people: Map<number, Person>): Record<FailingKind, string[]> {
  const dealable = all.filter((j) => j.inBox && j.showable);

  return {
    countMismatches: checks.countMismatches,
    outsMismatches: checks.outsMismatches,
    scoreMismatches: checks.scoreMismatches,
    runnersMismatches: checks.runnersMismatches,
    impossibleCounts: all.filter((j) => !countPossible(j.p)).map((j) => `${j.p.id}: ${j.p.balls}-${j.p.strikes} before the pitch`),
    challengesOnExcludedPitches: checks.challengesOnExcluded,
    orphanChallenges: checks.orphanReviews,
    challengeRoleAnomalies: checks.roleAnomalies,
    challengeMismatches: all
      .filter((j) => j.p.challenge && j.truth !== j.p.finalCall)
      .map((j) => `${j.p.id}: final call ${j.p.finalCall}, reconstruction ${j.truth} by ${round(Math.abs(j.marginIn), 2)} in`),
    umpireProblems: checks.umpireProblems,
    dealableWithoutBatterHeight: dealable.filter((j) => !people.get(j.p.batterId)?.heightIn).map((j) => `${j.p.id}: batter ${j.p.batterId}`),
    dealableWithoutPitchType: dealable.filter((j) => !j.p.pitchType).map((j) => j.p.id),
  };
}

function countBy(list: readonly Judged[], key: (j: Judged) => string): Record<string, number> {
  const counts = new Map<string, number>();

  for (const j of list) counts.set(key(j), (counts.get(key(j)) ?? 0) + 1);

  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
}

// Pitches too slow to deal. They stay in every season total; only dealing leaves them out.
export function slowPitches(all: readonly Judged[]) {
  const slow = all.filter((j) => j.flightS !== null && j.flightS > MAX_FLIGHT_S);
  // In the crossing box and showable but for their speed, so the flight-time bound alone keeps these from the deck.
  const onlyForSpeed = slow.filter((j) => j.inBox && j.p.mph !== null && j.p.attribution !== 'uncertain' && countPossible(j.p));
  const dealableFlights = all.flatMap((j) => (j.inBox && j.showable && j.flightS !== null ? [j.flightS] : []));
  const type = (j: Judged): string => j.p.pitchType ?? 'none';

  return {
    maxFlightS: MAX_FLIGHT_S,
    calledPitches: slow.length,
    byPitchType: countBy(slow, type),
    keptFromDealingOnlyForSpeed: onlyForSpeed.length,
    keptFromDealingByPitchType: countBy(onlyForSpeed, type),
    keptFromDealingByBand: countBy(onlyForSpeed, (j) => band(j)),
    slowestDealableS: round(
      dealableFlights.reduce((m, v) => Math.max(m, v), 0),
      4,
    ),
    slowest: [...slow]
      .sort((a, b) => (b.flightS ?? 0) - (a.flightS ?? 0) || a.seq - b.seq)
      .slice(0, 10)
      .map((j) => `${j.p.id}: ${type(j)} ${j.p.mph ?? '?'} mph, ${round(j.flightS ?? 0, 3)} s`),
  };
}

function plateReport(tracks: ReadonlyArray<{ game: Game; track: PlateTrack }>, nameOf: (id: number | null) => string | null) {
  const describe = ({ game, track }: { game: Game; track: PlateTrack }) => ({
    gamePk: game.gamePk,
    date: game.date,
    scheduled: nameOf(track.scheduledId),
    plate: plateRuns(track).map((r) => `${paAt(r.atBat, r.afterPitch)}: ${nameOf(r.umpireId) ?? 'no one named'}, ${r.called} called`),
    events: track.events.map((e) => `${paAt(e.atBat, e.afterPitch)}: [${e.reading}] ${e.text}`),
  });

  return {
    readings: READINGS,
    gamesWithUmpireChanges: tracks.length,
    umpireChanges: tracks.reduce((n, t) => n + t.track.events.length, 0),
    plateChanged: tracks.filter((t) => plateChanged(t.track)).map(describe),
    plateUnchanged: tracks.filter((t) => !plateChanged(t.track)).map(describe),
  };
}

export function buildDataset(inputs: Inputs): BuildResult {
  const log = inputs.log ?? ((): void => undefined);
  const teams = parseTeams(inputs.teams);
  const { games, skipped, officials } = parseSchedule(inputs.schedules);
  const checks: Checks = emptyChecks();
  const all: Judged[] = [];
  const missing: number[] = [];
  const plateTracks: Array<{ game: Game; track: PlateTrack }> = [];
  const unknownTeams = games.filter((g) => !teams.has(g.awayId) || !teams.has(g.homeId)).map((g) => g.gamePk);

  if (!games.length) throw new Error('The cached schedule has no completed games. Run npm run data:fetch.');
  if (unknownTeams.length) throw new Error(`Games with teams missing from /teams: ${unknownTeams.slice(0, 5).join(', ')}`);

  for (const [k, game] of games.entries()) {
    const pbp = inputs.loadPlays(game.gamePk);

    if (!pbp) {
      missing.push(game.gamePk);
      continue;
    }

    const extract = extractGame(pbp, game, inputs.people, officials);

    addChecks(checks, extract.checks);
    if (extract.plate.events.length) plateTracks.push({ game, track: extract.plate });
    for (const p of extract.pitches) all.push(judge(p, all.length));
    if ((k + 1) % 250 === 0) log(`  ${k + 1}/${games.length} games, ${all.length} called pitches`);
  }
  if (missing.length) {
    throw new Error(`${missing.length} games are not in the cache (${missing.slice(0, 5).join(', ')}). Run npm run data:fetch.`);
  }

  const findings = integrityFindings(all, checks, inputs.people);
  const verdict = judgeFindings(findings);

  if (verdict.failures.length) {
    throw new Error(
      `${verdict.failures.length} integrity findings outside the allowlist in lib/integrity.ts: ${verdict.failures.slice(0, 5).join('; ')}`,
    );
  }

  const teamAbbr = (id: number): string => teams.get(id)?.abbr ?? String(id);
  const umpireName = (id: number | null): string | null => (id === null ? null : (officials.get(id) ?? null));
  const umpireNamed = (id: number | null): Named | null => (id === null ? null : { id, name: umpireName(id) ?? `#${id}` });
  const pool = selectPool(all, SEED);
  const quantized = new Map<string, Quantized>(pool.entries.map((e) => [e.j.p.id, quantize(e.j)]));
  const players = new Map<number, { name: string; heightIn: number | null }>();
  const typeNames = new Map<string, Map<string, number>>();
  const note = (id: number, name: string): void => {
    const person = inputs.people.get(id);

    if (id !== 0 && !players.has(id)) players.set(id, { name: person?.name ?? name, heightIn: person?.heightIn ?? null });
  };

  for (const { j } of pool.entries) {
    const c = j.p.challenge;

    note(j.p.batterId, j.p.batterName);
    note(j.p.pitcherId, j.p.pitcherName);
    if (c) note(c.byId, c.byName);
    if (j.p.pitchType) {
      const names = typeNames.get(j.p.pitchType) ?? new Map<string, number>();
      const name = j.p.pitchTypeName ?? j.p.pitchType;

      names.set(name, (names.get(name) ?? 0) + 1);
      typeNames.set(j.p.pitchType, names);
    }
  }

  const pitchTypes = Object.fromEntries(
    [...typeNames]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([code, names]): [string, [string, string]] => [code, [mostCommon(names), familyOf(code)]]),
  );
  const gameById = new Map(games.map((g) => [g.gamePk, g]));
  const fields = {
    games: GAME_FIELDS,
    venues: NAME_FIELDS,
    umpires: NAME_FIELDS,
    players: PLAYER_FIELDS,
    pitches: PITCH_FIELDS,
    challenge: CHALLENGE_FIELDS,
  };
  const nameRows = (named: ReadonlyArray<Named | null>): Row[] =>
    [...new Map(named.flatMap((n) => (n ? [[n.id, n.name] as const] : []))).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, name]): Row => [id, name]);
  const shardText = (entries: readonly PoolEntry[], index: number, count: number): string => {
    const shardGames = [...new Set(entries.map((e) => e.j.p.gamePk))].flatMap((pk) => {
      const g = gameById.get(pk);

      return g ? [g] : [];
    });
    const ids = new Set<number>();

    for (const { j } of entries) {
      ids.add(j.p.batterId);
      ids.add(j.p.pitcherId);
      if (j.p.challenge) ids.add(j.p.challenge.byId);
    }

    const playerRows = [...ids]
      .filter((id) => players.has(id))
      .sort((a, b) => a - b)
      .map((id): Row => [id, players.get(id)?.name ?? '', players.get(id)?.heightIn ?? null]);
    const pitchRows = entries.map((e) => {
      const q = quantized.get(e.j.p.id) ?? quantize(e.j);

      return pitchRow(e.j, q, e.dealable, teamAbbr);
    });
    const head = {
      format: SHARD_FORMAT,
      version: FORMAT_VERSION,
      season: SEASON,
      shard: index,
      shards: count,
      credit: CREDIT,
      truthNote: TRUTH_NOTE,
      fields,
      pitchTypes,
    };

    return rowsJson(head, [
      ['games', shardGames.map((g) => gameRow(g, teamAbbr))],
      ['venues', nameRows(shardGames.map((g) => g.venue))],
      ['umpires', nameRows(entries.map((e) => umpireNamed(e.j.p.umpireId)))],
      ['players', playerRows],
      ['pitches', pitchRows],
    ]);
  };

  const count = Math.max(1, Math.ceil(pool.entries.length / PITCHES_PER_SHARD));
  const shards = makeShards(pool.entries, count, SEED);
  const texts = shards.map((s, i) => shardText(s, i, count));
  const width = Math.max(2, String(count - 1).length);
  const shardFile = (i: number): string => `shards/${String(i).padStart(width, '0')}.json`;
  const dealing = shards.map((s, i) => {
    const cards = s.map(cardOf).filter((c) => c.dealable);

    return { shard: i, ...dealingCheck(cards, `${SEED}|deal|${i}`, DEALS_PER_SHARD) };
  });
  const dealProblems = dealing.flatMap((d) => d.problems.map((p) => `shard ${d.shard} ${p}`));

  if (dealProblems.length) throw new Error(`Some shards cannot deal a full ten: ${dealProblems.slice(0, 5).join('; ')}`);

  const challenged = all.filter((j) => j.p.challenge);
  const poolDealable = pool.entries.filter((e) => e.dealable);
  const inBand = (b: string): number => poolDealable.filter((e) => band(e.j) === b).length;
  // Every pile counts the dealable pitches in its band, challenged ones included, as the dealer draws them.
  const composition = {
    pitches: pool.entries.length,
    dealable: poolDealable.length,
    closeWithinIn: CLOSE_IN,
    close: inBand('close'),
    nearWithinIn: NEAR_IN,
    near: inBand('near'),
    // Between the near and calibrator bands: in the pool only when challenged, and never dealt.
    mid: inBand('mid'),
    calibratorMinIn: CALIBRATOR_MIN_IN,
    calibrators: inBand('clear'),
    challenged: challenged.length,
    challengedDealable: pool.entries.filter((e) => e.bucket === 'challenge' && e.dealable).length,
    sampled: { near: pool.entries.filter((e) => e.bucket === 'near').length, calibrators: pool.entries.filter((e) => e.bucket === 'calibrator').length },
    sampledPerClose: PER_CLOSE,
    seasonDealable: pool.season,
  };
  const shardMeta = shards.map((s, i) => ({
    file: shardFile(i),
    pitches: s.length,
    dealable: s.filter((e) => e.dealable).length,
    bytes: Buffer.byteLength(texts[i] ?? ''),
    sha256: sha256(texts[i] ?? ''),
  }));
  const usedTeams = new Set(games.flatMap((g) => [g.awayId, g.homeId]));
  const manifest: ManifestDoc = {
    format: MANIFEST_FORMAT,
    version: FORMAT_VERSION,
    season: SEASON,
    credit: CREDIT,
    truthNote: TRUTH_NOTE,
    source: 'MLB Stats API (statsapi.mlb.com): teams, schedule (with officials), game playByPlay and people endpoints.',
    coverage: {
      gameTypes: GAME_TYPES,
      firstDate: games[0]?.date ?? null,
      lastDate: games.at(-1)?.date ?? null,
      games: games.length,
      gamesWithVenue: games.filter((g) => g.venue).length,
      calledPitchesWithPlateUmpire: all.filter((j) => j.p.umpireId !== null).length,
      calledPitches: all.length,
      challenges: challenged.length,
    },
    conventions: {
      units: 'feet, seconds and mph; names ending in In are inches',
      axes: "catcher's view: x across the plate (+x toward first base), y toward the pitcher (0 at the back tip of the plate), z up",
      trajectory: 'p(t) = p0 + v0 t + a t^2 / 2 from x0..aZ, with t = 0 at y0 (about 50 ft); release is at y = 60.5 - extension',
      absRule: `strike if any part of the ball (r = ${BALL_RADIUS_IN} in) touches the ${2 * PLATE_HALF_IN} in x [zoneBottom, zoneTop] rectangle at mid-plate (y = 8.5/12 ft)`,
      calls: 'ump is the plate umpire\'s original call, final the call after any ABS challenge, abs our reconstruction; S = strike, B = ball',
      marginIn: 'how far the ball would have to move to flip abs, rounded to 0.01 in; positive for strikes; abs is authoritative when it rounds to 0',
      bases: 'bitmask of occupied bases before the pitch: 1 = first, 2 = second, 4 = third',
      games:
        "played order is date, then start, then gamePk; start is the scheduled start in ISO UTC (the schedule's gameDate); venue is an id into the venues table",
      umpire:
        "a pitch's plate umpire, an id into the umpires table: the one the schedule lists, followed through the play log's umpire changes; null where the log leaves it unknown",
      flags: 'top, dealable and challenge.overturned are 1 or 0; challenge.role is B (batter), P (pitcher) or C (catcher)',
      id: 'a pitch is gamePk-atBat-pitch',
    },
    rules: {
      ballRadiusIn: BALL_RADIUS_IN,
      plateHalfWidthIn: PLATE_HALF_IN,
      judgePlaneYFt: MID_Y,
      frontOfPlateYFt: PLATE_FRONT_Y,
      rubberYFt: RUBBER_Y,
      dealBox: DEAL_BOX,
      maxFlightS: MAX_FLIGHT_S,
      closeIn: CLOSE_IN,
      nearIn: NEAR_IN,
      calibratorMinIn: CALIBRATOR_MIN_IN,
    },
    gameTypes: GAME_TYPE_NAMES,
    teams: Object.fromEntries(
      [...teams.values()]
        .filter((t) => usedTeams.has(t.id))
        .sort((a, b) => (a.abbr < b.abbr ? -1 : 1))
        .map((t) => [t.abbr, t.name]),
    ),
    pitchTypes,
    fields,
    pool: composition,
    session: { budgetGzipBytes: SESSION_BUDGET_GZIP, files: ['manifest.json', 'stats.json', 'one shard'] },
    shards: shardMeta,
  };
  const ump = umpVsAbs(all);
  const stats: StatsDoc = {
    format: STATS_FORMAT,
    version: FORMAT_VERSION,
    season: SEASON,
    credit: CREDIT,
    truthNote: TRUTH_NOTE,
    games: { total: games.length, byType: Object.fromEntries(GAME_TYPES.map((t) => [t, games.filter((g) => g.gameType === t).length])) },
    calledPitches: {
      total: all.length,
      calledStrikes: all.filter((j) => j.p.finalCall === 'S').length,
      balls: all.filter((j) => j.p.finalCall === 'B').length,
      byType: byGameType(all, games, (some) => some.length),
    },
    excluded: { ballInDirt: checks.ballInDirt, automatic: checks.automatic, noTracking: checks.noTracking },
    challenges: challengeStats(all),
    umpVsAbs: ump,
    umpVsAbsByGameType: byGameType(all, games, (some) => {
      const u = umpVsAbs(some);

      return { overall: u.overall, close: u.close };
    }),
  };
  const manifestText = pretty(manifest);
  const statsText = pretty(stats);
  const sizes = sessionSizes(manifestText, statsText, texts);

  if (sizes.largestSessionGzipBytes > SESSION_BUDGET_GZIP) {
    throw new Error(
      `A play session would download ${sizes.largestSessionGzipBytes} gzipped bytes (budget ${SESSION_BUDGET_GZIP}); lower PITCHES_PER_SHARD`,
    );
  }

  const decimals: Record<string, number> = {};
  let marginDrift = 0;

  for (const e of pool.entries) {
    const q = quantized.get(e.j.p.id);

    if (!q) continue;

    const mid = crossing(q.traj);
    const recomputed = absJudge(mid.x, mid.z, q.zoneTop, q.zoneBottom).marginIn;
    const key = q.decimals === null ? 'full' : String(q.decimals);

    decimals[key] = (decimals[key] ?? 0) + 1;
    marginDrift = Math.max(marginDrift, Math.abs(recomputed - round(e.j.marginIn, 2)));
  }

  const mismatches = challengeMismatches(all, inputs.people, games);
  const geometricOnly = all.filter((j) => j.inBox && !j.showable);
  const report = {
    note: 'Written by npm run data:build from the cached MLB Stats API responses. Deterministic: rebuilding gives the same file.',
    season: SEASON,
    schedule: {
      games: games.length,
      byType: stats.games.byType,
      skippedListings: skipped,
      venues: new Set(games.flatMap((g) => (g.venue ? [g.venue.id] : []))).size,
      scheduledPlateUmpires: new Set(games.flatMap((g) => (g.scheduledUmpire ? [g.scheduledUmpire.id] : []))).size,
      gamesWithoutVenue: sample(games.filter((g) => !g.venue).map((g) => String(g.gamePk))),
      gamesWithoutScheduledPlateUmpire: sample(games.filter((g) => !g.scheduledUmpire).map((g) => String(g.gamePk))),
    },
    plateUmpire: {
      onPitches: new Set(all.flatMap((j) => (j.p.umpireId === null ? [] : [j.p.umpireId]))).size,
      calledPitchesWithoutOne: all.filter((j) => j.p.umpireId === null).length,
      ...plateReport(plateTracks, umpireName),
    },
    integrity: {
      plays: checks.plays,
      pitchEvents: checks.pitchEvents,
      calledCodes: checks.calledCodes,
      calledPitchesKept: all.length,
      excluded: stats.excluded,
      runnersChecked: checks.runnersChecked,
      // These fail the build unless pinned in the allowlist.
      ...Object.fromEntries(FAILING_KINDS.map((k) => [k, sample(findings[k])])),
      enforced: { allowlist: ALLOWED, allowed: verdict.allowed, staleAllowlist: verdict.stale },
      catcherChallengesByListedPosition: Object.fromEntries(
        Object.entries(checks.catcherListedAs).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)),
      ),
      midPlateAppearanceSubstitutions: sample(checks.midPaSubstitutions),
      attribution: {
        matchup: all.filter((j) => j.p.attribution === 'matchup').length,
        replaced: all.filter((j) => j.p.attribution === 'replaced').length,
        uncertain: all.filter((j) => j.p.attribution === 'uncertain').length,
      },
      missingExtensionOrSpeed: all.filter((j) => j.p.extension === null || j.p.mph === null).length,
      challengeSources: {
        pitchEvent: challenged.filter((j) => j.p.challenge?.source === 'pitch').length,
        playOnly: challenged.filter((j) => j.p.challenge?.source === 'play').length,
      },
    },
    model: {
      challengeAgreement: stats.challenges.absAgreesWithFinalCall,
      challengeMismatches: { count: mismatches.length, closest: mismatches.slice(0, 300) },
      variants: variants(all, inputs.people),
      zones: zoneChecks(all, inputs.people),
      feedPxPzResiduals: pxpzResiduals(all),
      releaseSides: releaseSides(all),
    },
    umpVsAbs: ump,
    dealableRule: {
      geometric: all.filter((j) => j.inBox).length,
      geometricButNotShowable: geometricOnly.length,
      geometricButNotShowableInPoolRange: pool.notShowable,
      slowPitches: slowPitches(all),
    },
    storedPrecision: { decimalsUsed: decimals, maxMarginDriftIn: round(marginDrift, 4) },
    pool: composition,
    shards: shardMeta.map((m, i) => {
      const d = dealing[i];

      return {
        ...m,
        calibrators: d?.calibrators,
        close: d?.close,
        closeChallenged: d?.closeChallenged,
        near: d?.near,
        dealsChecked: d?.deals,
      };
    }),
  };
  const files = new Map<string, string>([
    [`${OUT_DIR}/manifest.json`, manifestText],
    [`${OUT_DIR}/stats.json`, statsText],
    ...texts.map((t, i): [string, string] => [`${OUT_DIR}/${shardFile(i)}`, t]),
    [REPORT_PATH, pretty(report)],
  ]);
  const ch = stats.challenges;
  const kb = (n: number): string => `${(n / 1000).toFixed(0)} KB`;
  const summary = [
    `games ${games.length} (${GAME_TYPES.map((t) => `${t} ${stats.games.byType[t]}`).join(', ')})`,
    `called pitches ${all.length} (left out: ${checks.ballInDirt} in the dirt, ${checks.noTracking} untracked; ${checks.automatic} automatic balls and strikes are not pitches)`,
    `challenges ${ch.total}, overturned ${ch.overturned}; ABS truth = final call on ${ch.absAgreesWithFinalCall.agree}/${ch.absAgreesWithFinalCall.total} (${ch.absAgreesWithFinalCall.pct}%)`,
    `ump vs ABS: overall ${ump.overall.agree}/${ump.overall.total} (${ump.overall.pct}%), within ${CLOSE_IN} in ${ump.close.agree}/${ump.close.total} (${ump.close.pct}%)`,
    `pool ${composition.pitches}: close ${composition.close} of ${pool.season.close}, near ${composition.near} of ${pool.season.near}, calibrators ${composition.calibrators} of ${pool.season.clear} clear calls, ${composition.mid} challenged between ${NEAR_IN} and ${CALIBRATOR_MIN_IN} in, challenged ${composition.challenged}`,
    `shards ${count}: ${kb(Math.min(...sizes.shardBytes))}-${kb(Math.max(...sizes.shardBytes))} raw, ${kb(Math.min(...sizes.shardGzipBytes))}-${kb(Math.max(...sizes.shardGzipBytes))} gzipped; largest session ${kb(sizes.largestSessionGzipBytes)} of ${kb(SESSION_BUDGET_GZIP)}`,
    `integrity: count ${checks.countMismatches.length}, outs ${checks.outsMismatches.length}, runners ${checks.runnersMismatches.length}/${checks.runnersChecked}, score ${checks.scoreMismatches.length}; ${verdict.allowed.length} allowlisted findings (${verdict.allowed.join('; ')})${verdict.stale.length ? `; stale pins: ${verdict.stale.join(', ')}` : ''}`,
    `plate umpire: changed or unknown in ${report.plateUmpire.plateChanged.length} games (${report.plateUmpire.plateChanged.map((g) => g.gamePk).join(', ')}); ${report.plateUmpire.calledPitchesWithoutOne} called pitches name no one`,
    `slow pitches (over ${MAX_FLIGHT_S} s to the plate): ${report.dealableRule.slowPitches.calledPitches} called, ${report.dealableRule.slowPitches.keptFromDealingOnlyForSpeed} kept from dealing only for speed`,
  ];

  return { files, summary, sizes };
}

export function sessionSizes(manifestText: string, statsText: string, shardTexts: readonly string[]): SessionSizes {
  const shardGzipBytes = shardTexts.map(gzipBytes);
  const manifestGzipBytes = gzipBytes(manifestText);
  const statsGzipBytes = gzipBytes(statsText);

  return {
    shardBytes: shardTexts.map((t) => Buffer.byteLength(t)),
    shardGzipBytes,
    manifestGzipBytes,
    statsGzipBytes,
    largestSessionGzipBytes: manifestGzipBytes + statsGzipBytes + Math.max(...shardGzipBytes),
  };
}
