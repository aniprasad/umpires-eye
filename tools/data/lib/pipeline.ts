import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  BALL_RADIUS_IN,
  CALIBRATOR_MIN_IN,
  CLOSE_IN,
  CREDIT,
  DEALABLE,
  GAME_TYPE_NAMES,
  GAME_TYPES,
  MID_Y,
  NEAR_IN,
  PLATE_FRONT_Y,
  PLATE_HALF_IN,
  RUBBER_Y,
  SEASON,
  SESSION_BUDGET_GZIP,
  TRUTH_NOTE,
} from './constants.ts';
import { deckOf, dealTen, tenProblems, type Card } from './deal.ts';
import {
  CHALLENGE_FIELDS,
  familyOf,
  FORMAT_VERSION,
  GAME_FIELDS,
  MANIFEST_FORMAT,
  PITCH_FIELDS,
  PLAYER_FIELDS,
  pitchRow,
  quantize,
  round,
  rowsJson,
  SHARD_FORMAT,
  STATS_FORMAT,
  type Quantized,
  type Row,
} from './format.ts';
import { judge, type Judged } from './judge.ts';
import type { PlayByPlay, ScheduleResponse, TeamsResponse } from './mlb.ts';
import type { Person } from './people.ts';
import { absJudge, crossing } from './physics.ts';
import { addChecks, emptyChecks, extractGame, type Checks } from './plays.ts';
import { makeShards, selectPool, storedAbsMargin, type PoolEntry } from './pool.ts';
import { hash32, mulberry32 } from './rng.ts';
import { parseSchedule, parseTeams, type Game } from './schedule.ts';
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

export const OUT_DIR = 'public/data/season-2026';
export const REPORT_PATH = 'tools/data/reports/season-2026.json';
export const SEED = 'umpires-eye-2026';
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
  const deck = deckOf(cards);
  const rand = mulberry32(hash32(seed));
  const problems: string[] = [];

  for (let k = 0; k < deals; k++) {
    const ten = dealTen(deck, rand);
    const found = ten ? tenProblems(ten) : ['not enough pitches'];

    for (const p of found) problems.push(`deal ${k}: ${p}`);
  }

  return {
    calibrators: deck.calibrators.length,
    close: deck.close.length,
    closeChallenged: deck.closeChallenged.length,
    near: deck.near.length,
    deals,
    problems,
  };
}

function sample(list: readonly string[]): { count: number; first: string[] } {
  return { count: list.length, first: list.slice(0, SAMPLE) };
}

export function buildDataset(inputs: Inputs): BuildResult {
  const log = inputs.log ?? ((): void => undefined);
  const teams = parseTeams(inputs.teams);
  const { games, skipped } = parseSchedule(inputs.schedules);
  const checks: Checks = emptyChecks();
  const all: Judged[] = [];
  const missing: number[] = [];
  const unknownTeams = games.filter((g) => !teams.has(g.awayId) || !teams.has(g.homeId)).map((g) => g.gamePk);

  if (!games.length) throw new Error('The cached schedule has no completed games. Run npm run data:fetch.');
  if (unknownTeams.length) throw new Error(`Games with teams missing from /teams: ${unknownTeams.slice(0, 5).join(', ')}`);

  for (const [k, game] of games.entries()) {
    const pbp = inputs.loadPlays(game.gamePk);

    if (!pbp) {
      missing.push(game.gamePk);
      continue;
    }

    const extract = extractGame(pbp, game, inputs.people);

    addChecks(checks, extract.checks);
    for (const p of extract.pitches) all.push(judge(p, all.length));
    if ((k + 1) % 250 === 0) log(`  ${k + 1}/${games.length} games, ${all.length} called pitches`);
  }
  if (missing.length) {
    throw new Error(`${missing.length} games are not in the cache (${missing.slice(0, 5).join(', ')}). Run npm run data:fetch.`);
  }

  const teamAbbr = (id: number): string => teams.get(id)?.abbr ?? String(id);
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
    [...typeNames].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([code, names]) => [code, [mostCommon(names), familyOf(code)]]),
  );
  const gameById = new Map(games.map((g) => [g.gamePk, g]));
  const gameRow = (g: Game): Row => [g.gamePk, g.date, g.gameType, teamAbbr(g.awayId), teamAbbr(g.homeId), g.series, g.seriesGame];
  const fields = { games: GAME_FIELDS, players: PLAYER_FIELDS, pitches: PITCH_FIELDS, challenge: CHALLENGE_FIELDS };
  const shardText = (entries: readonly PoolEntry[], index: number, count: number): string => {
    const gamePks = [...new Set(entries.map((e) => e.j.p.gamePk))];
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
    const gameRows = gamePks.flatMap((pk) => {
      const g = gameById.get(pk);

      return g ? [gameRow(g)] : [];
    });
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
      ['games', gameRows],
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
  const composition = {
    pitches: pool.entries.length,
    dealable: poolDealable.length,
    closeWithinIn: CLOSE_IN,
    close: poolDealable.filter((e) => storedAbsMargin(e.j) <= CLOSE_IN).length,
    nearWithinIn: NEAR_IN,
    near: poolDealable.filter((e) => storedAbsMargin(e.j) > CLOSE_IN && storedAbsMargin(e.j) <= NEAR_IN).length,
    calibratorMinIn: CALIBRATOR_MIN_IN,
    calibrators: pool.entries.filter((e) => e.bucket === 'calibrator').length,
    clearCallsSampledFrom: pool.clearEligible,
    challenged: challenged.length,
    challengedDealable: pool.entries.filter((e) => e.bucket === 'challenge' && e.dealable).length,
  };
  const shardMeta = shards.map((s, i) => ({
    file: shardFile(i),
    pitches: s.length,
    dealable: s.filter((e) => e.dealable).length,
    bytes: Buffer.byteLength(texts[i] ?? ''),
    sha256: sha256(texts[i] ?? ''),
  }));
  const usedTeams = new Set(games.flatMap((g) => [g.awayId, g.homeId]));
  const manifest = {
    format: MANIFEST_FORMAT,
    version: FORMAT_VERSION,
    season: SEASON,
    credit: CREDIT,
    truthNote: TRUTH_NOTE,
    source: 'MLB Stats API (statsapi.mlb.com): schedule, teams, game playByPlay and people endpoints.',
    coverage: {
      gameTypes: GAME_TYPES,
      firstDate: games[0]?.date ?? null,
      lastDate: games.at(-1)?.date ?? null,
      games: games.length,
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
      flags: 'top, dealable and challenge.overturned are 1 or 0; challenge.role is B (batter), P (pitcher) or C (catcher)',
      id: 'a pitch is gamePk-atBat-pitch',
    },
    rules: {
      ballRadiusIn: BALL_RADIUS_IN,
      plateHalfWidthIn: PLATE_HALF_IN,
      judgePlaneYFt: MID_Y,
      frontOfPlateYFt: PLATE_FRONT_Y,
      rubberYFt: RUBBER_Y,
      dealable: DEALABLE,
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
  const stats = {
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
  const geometricOnly = all.filter((j) => j.dealable && !j.renderable);
  const report = {
    note: 'Written by npm run data:build from the cached MLB Stats API responses. Deterministic: rebuilding gives the same file.',
    season: SEASON,
    schedule: { games: games.length, byType: stats.games.byType, skippedListings: skipped },
    integrity: {
      plays: checks.plays,
      pitchEvents: checks.pitchEvents,
      calledCodes: checks.calledCodes,
      calledPitchesKept: all.length,
      excluded: stats.excluded,
      runnersChecked: checks.runnersChecked,
      countMismatches: sample(checks.countMismatches),
      outsMismatches: sample(checks.outsMismatches),
      scoreMismatches: sample(checks.scoreMismatches),
      runnersMismatches: sample(checks.runnersMismatches),
      challengesOnExcludedPitches: sample(checks.challengesOnExcluded),
      orphanChallenges: sample(checks.orphanReviews),
      challengeRoleAnomalies: sample(checks.roleAnomalies),
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
      geometric: all.filter((j) => j.dealable).length,
      geometricButNotDrawable: geometricOnly.length,
      geometricButNotDrawableInPoolRange: pool.undrawable,
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
    `pool ${composition.pitches}: close ${composition.close}, near ${composition.near}, calibrators ${composition.calibrators}, challenged ${composition.challenged}`,
    `shards ${count}: ${kb(Math.min(...sizes.shardBytes))}-${kb(Math.max(...sizes.shardBytes))} raw, ${kb(Math.min(...sizes.shardGzipBytes))}-${kb(Math.max(...sizes.shardGzipBytes))} gzipped; largest session ${kb(sizes.largestSessionGzipBytes)} of ${kb(SESSION_BUDGET_GZIP)}`,
    `integrity: count ${checks.countMismatches.length}, outs ${checks.outsMismatches.length}, runners ${checks.runnersMismatches.length}/${checks.runnersChecked}, score ${checks.scoreMismatches.length}`,
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
