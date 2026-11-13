// A small synthetic 2026 season in the dataset's own formats (docs/DATA.md), for the tests that load the season source:
// manifest.json, one shard (or two), the November 2026 month file and stats.json. Names and numbers are made up. Each path is
// solved to cross mid-plate where its pitch is meant to, and its ABS truth, margin and dealable flag are worked out from
// that path, so the files agree with themselves the way data:build's do. The same calls give the same files.
import { createHash } from 'node:crypto';
import { absJudge, inDealBox } from '../../src/core/abs.ts';
import { isDailyReserve } from '../../src/core/daily.ts';
import { dealTen, pilesOf } from '../../src/core/deal.ts';
import { crossing, quickEnough, tAtY, type Traj } from '../../src/core/kinematics.ts';
import { mulberry32 } from '../../src/core/rng.ts';
import { BALL_R, CLOSE_IN, CREDIT, MID_Y, PLATE_HALF, RUBBER_Y, SEASON, TRUTH_NOTE } from '../../src/core/rules.ts';
import {
  CHALLENGE_FIELDS,
  DAILY_FORMAT,
  FORMAT_VERSION,
  GAME_FIELDS,
  MANIFEST_FORMAT,
  NAME_FIELDS,
  PITCH_FIELDS,
  PLAYER_FIELDS,
  SHARD_FORMAT,
  STATS_FORMAT,
  type PitchField,
} from '../../src/core/schema.ts';

type Cells = Record<PitchField, unknown>;
type Kind = 'calibrator' | 'close' | 'near' | 'mid';

/** One pitch of the ten a round plays, with what the round should show for it. */
export interface MiniPitch {
  readonly id: string;
  readonly abs: 'S' | 'B';
  readonly ump: 'S' | 'B';
  /** The matchup line's game label, written out by hand rather than by the app's code. */
  readonly label: string;
  readonly balls: number;
  readonly strikes: number;
}

export interface SeasonMini {
  /** Each file's body by its path under data/season-2026/. */
  readonly files: ReadonlyMap<string, Record<string, unknown>>;
  readonly build: string;
  /** The schedule's first and last dates. */
  readonly first: string;
  readonly last: string;
  /** The date with a ten, and the ten in play order. */
  readonly date: string;
  readonly ten: readonly MiniPitch[];
  /** Each available date's ten, by ID in play order. */
  readonly days: ReadonlyMap<string, readonly string[]>;
  /** A served date whose ten became unavailable. */
  readonly unavailableDate: string;
  /** The first shard's address, ?v= included. */
  readonly shardUrl: string;
  /** The rows Another ten may deal from the first shard: dealable and not held back for Today's Ten, in played order. */
  readonly deckIds: readonly string[];
  /** Every shard's address and the rows Another ten may deal from it, in the manifest's order. */
  readonly shards: readonly { readonly url: string; readonly deckIds: readonly string[] }[];
}

export interface SeasonMiniOptions {
  /**
   * Two splits the games between two shards and leaves each exactly eight close calls Another ten may deal, at least one
   * challenged, so each shard deals one ten and then runs dry. One, the default, keeps every row in a single shard.
   */
  readonly shards?: 1 | 2;
  /**
   * A schedule from 2026-11-01 to 2026-12-01, over a November and a December month file. Each date has a ten of its own,
   * dealt from the same reserve, so two dates' tens may share pitches; the unavailable date has none. Without it, the
   * schedule is just the date and the unavailable date.
   */
  readonly calendar?: boolean;
}

/** Games in played order: a doubleheader, another regular-season date, and a World Series game. */
const GAMES = [
  { row: [900101, '2026-05-14', '2026-05-14T17:05:00Z', 'R', 'AWY', 'HOM', null, null, 1], label: 'May 14, 2026', umps: [501, 502] },
  { row: [900102, '2026-05-14', '2026-05-14T23:10:00Z', 'R', 'AWY', 'HOM', null, null, 1], label: 'May 14, 2026', umps: [503] },
  { row: [900103, '2026-08-02', '2026-08-02T18:10:00Z', 'R', 'VIS', 'HOM', null, null, 1], label: 'August 2, 2026', umps: [502] },
  { row: [900201, '2026-10-21', '2026-10-22T00:08:00Z', 'W', 'VIS', 'HOM', 'World Series', 3, 2], label: '2026 World Series · Game 3', umps: [501] },
] as const;

const VENUES = [[1, 'Home Park'], [2, 'Visitor Field']] as const;
const UMPIRES = [[501, 'Alex Plate'], [502, 'Blake Relief'], [503, 'Casey Calls']] as const;
// The third batter has no height on file, so the app takes it from his zone.
const BATTERS = [[101, 'Sam Example', 74, 'R'], [102, 'Lee Sample', 70, 'L'], [103, 'Kim Placeholder', null, 'R'], [104, 'Ash Fixture', 77, 'L']] as const;
const PITCHERS = [[201, 'Pat Righty', 'R'], [202, 'Lou Lefty', 'L']] as const;
const CATCHERS = [[301, 'Cal Catcher'], [302, 'Max Mitt']] as const;
const TYPES = {
  FF: { name: 'Four-Seam Fastball', family: 'fastball', mph: 95, ax: -7, az: -15 },
  SI: { name: 'Sinker', family: 'fastball', mph: 93, ax: -15, az: -22 },
  SL: { name: 'Slider', family: 'breaking', mph: 86, ax: 4, az: -30 },
  CH: { name: 'Changeup', family: 'offspeed', mph: 85, ax: -13, az: -26 },
  CU: { name: 'Curveball', family: 'breaking', mph: 79, ax: 6, az: -40 },
} as const;
const TYPE_CODES = Object.keys(TYPES) as (keyof typeof TYPES)[];
// Half the pitches are close calls and a quarter near ones, so the reserve and the deck both hold enough to deal a ten.
const PATTERN: readonly Kind[] = ['calibrator', 'close', 'near', 'close', 'close', 'near', 'close', 'mid'];
const AT_BATS = 12;
const PITCHES_PER_AT_BAT = 2;

const round = (v: number, places: number): number => Number(v.toFixed(places));
const sha256 = (body: unknown): string => createHash('sha256').update(JSON.stringify(body)).digest('hex');
const idOf = (r: Cells): string => `${String(r.gamePk)}-${String(r.atBat)}-${String(r.pitch)}`;

/** A margin in inches for each kind of call, positive for a strike. */
function marginFor(kind: Kind, u: number, strike: boolean): number {
  const size = { calibrator: 6.5 + 3 * u, close: 0.1 + 1.3 * u, near: 1.7 + 2.6 * u, mid: 4.7 + 1.1 * u }[kind];

  return strike ? size : -size;
}

/**
 * Where a pitch with that margin crosses mid-plate: past the side of the plate, or over the top of the zone where the
 * side would leave the deal box.
 */
function crossingFor(marginIn: number, top: number, bottom: number, side: number): { x: number; z: number } {
  // how far the ball's centre is outside the zone's rectangle (negative inside)
  const d = BALL_R - marginIn / 12;

  return PLATE_HALF + d < 1.4 ? { x: side * (PLATE_HALF + d), z: (top + bottom) / 2 } : { x: side * 0.3, z: top + d };
}

/** A path from the release point to the mid-plate crossing, with the pitch type's movement, to four decimals. */
function pathThrough(rel: { x: number; z: number }, extension: number, mid: { x: number; z: number }, mph: number, ax: number, az: number): Traj {
  const vY0 = -mph * 1.46667 * 0.92;
  const base: Traj = { x0: 0, y0: 50, z0: 0, vX0: 0, vY0, vZ0: 0, aX: ax, aY: mph > 60 ? 28 : 12, aZ: az };
  const tR = tAtY(base, RUBBER_Y - extension);
  const tM = tAtY(base, MID_Y);
  const solve = (r: number, m: number, a: number): [number, number] => {
    const v = (m - r - 0.5 * a * (tM * tM - tR * tR)) / (tM - tR);

    return [m - v * tM - 0.5 * a * tM * tM, v];
  };
  const [x0, vX0] = solve(rel.x, mid.x, ax);
  const [z0, vZ0] = solve(rel.z, mid.z, az);

  return Object.fromEntries(Object.entries({ ...base, x0, vX0, z0, vZ0 }).map(([k, v]) => [k, round(v, 4)])) as unknown as Traj;
}

/** Two rows the data tools would store as not dealable: one with no extension, one too slow to stay in frame. */
function undealableRows(gamePk: number): Cells[] {
  const zoneTop = round(0.535 * 6, 3);
  const zoneBottom = round(0.27 * 6, 3);
  const close = pathThrough({ x: -1.9, z: 5.8 }, 6.5, { x: 0.75, z: 2.4 }, 94, 7, -15);
  const lob = pathThrough({ x: -1.9, z: 6.1 }, 6.0, { x: 0, z: 2.5 }, 48, 0, -32);
  const row = (atBat: number, traj: Traj, mph: number, extension: number | null): Cells => {
    const mid = crossing(traj);
    const judge = absJudge(mid.x, mid.z, zoneTop, zoneBottom);
    const abs = judge.strike ? 'S' : 'B';

    return {
      gamePk, atBat, pitch: 1, inning: 9, top: 0, outs: 2, balls: 0, strikes: 0, awayScore: 2, homeScore: 3, bases: 0,
      batter: 101, bats: 'R', pitcher: 201, throws: 'R', umpire: 502, type: 'FF', mph, ...traj, extension, zoneTop, zoneBottom,
      ump: abs, final: abs, abs, marginIn: round(judge.marginIn, 2), dealable: 0, challenge: null,
    };
  };

  if (quickEnough(lob, 6.0)) throw new Error('season-mini: the lob is meant to be too slow to deal');

  return [row(AT_BATS + 1, close, 94.2, null), row(AT_BATS + 2, lob, 48.3, 6.0)];
}

/** Every row of the shard, in played order. */
function pitchRows(): Cells[] {
  const rand = mulberry32(20261114);
  const rows: Cells[] = [];
  let k = 0;

  for (const [g, game] of GAMES.entries()) {
    const [gamePk, , , , away] = game.row;

    for (let atBat = 1; atBat <= AT_BATS; atBat++) {
      const [batter, , heightIn, bats] = BATTERS[(atBat + g) % BATTERS.length];
      const [pitcher, , throws] = PITCHERS[atBat > AT_BATS / 2 ? 1 : 0];
      const top = atBat % 2 === 1;
      const h = (heightIn ?? 72) / 12;
      const zoneTop = round(0.535 * h, 3);
      const zoneBottom = round(0.27 * h, 3);

      for (let pitch = 1; pitch <= PITCHES_PER_AT_BAT; pitch++, k++) {
        const kind = PATTERN[k % PATTERN.length];
        const code = TYPE_CODES[k % TYPE_CODES.length];
        const type = TYPES[code];
        const arm = throws === 'L' ? 1 : -1;
        const extension = round(6.2 + 0.7 * rand(), 2);
        const rel = { x: arm * (1.7 + 0.4 * rand()), z: 5.6 + 0.5 * rand() };
        const target = crossingFor(marginFor(kind, rand(), rand() < 0.5), zoneTop, zoneBottom, rand() < 0.5 ? -1 : 1);
        const traj = pathThrough(rel, extension, target, type.mph, arm * type.ax, type.az);
        const mid = crossing(traj);
        const judge = absJudge(mid.x, mid.z, zoneTop, zoneBottom);
        const abs = judge.strike ? 'S' : 'B';
        const umpWrong = kind === 'close' && k % 3 === 0;
        const ump = umpWrong ? (abs === 'S' ? 'B' : 'S') : abs;
        const challenged = kind === 'close' && (k % 5 === 1 || (umpWrong && k % 2 === 0));
        // whoever lost the call challenges it: the batter a strike, the catcher a ball
        const byBatter = ump === 'S';

        if (!inDealBox(mid) || !quickEnough(traj, extension)) throw new Error(`season-mini: pitch ${gamePk}-${atBat}-${pitch} isn't dealable`);
        rows.push({
          gamePk,
          atBat,
          pitch,
          inning: Math.min(9, 1 + Math.floor((atBat - 1) / 2)),
          top: top ? 1 : 0,
          outs: atBat % 3,
          balls: Math.min(3, pitch - 1 + (atBat % 2)),
          strikes: (atBat + pitch) % 3,
          awayScore: Math.floor(atBat / 5),
          homeScore: Math.floor(atBat / 4),
          bases: atBat % 8,
          batter,
          bats,
          pitcher,
          throws,
          // the first game's plate umpire hands over halfway, and the World Series game's last pitch has none on record
          umpire: g === 3 && atBat === AT_BATS && pitch === PITCHES_PER_AT_BAT ? null : game.umps[atBat > AT_BATS / 2 ? game.umps.length - 1 : 0],
          type: g === 2 && atBat === 3 && pitch === 1 ? null : code,
          mph: round(type.mph + rand() - 0.5, 1),
          ...traj,
          extension,
          zoneTop,
          zoneBottom,
          ump,
          final: challenged && umpWrong ? abs : ump,
          abs,
          marginIn: round(judge.marginIn, 2),
          dealable: 1,
          challenge: challenged ? [byBatter ? batter : CATCHERS[g % 2][0], byBatter === top ? away : 'HOM', byBatter ? 'B' : 'C', umpWrong ? 1 : 0] : null,
        });
      }
    }
    if (g === 2) rows.push(...undealableRows(gamePk));
  }

  return rows;
}

/** The rows' dealable cards, from the daily reserve or from outside it. */
const cardsOf = (rows: readonly Cells[], reserved: boolean) =>
  rows.flatMap((r, seq) => (r.dealable && isDailyReserve(idOf(r)) === reserved ? [{ id: idOf(r), seq, absMarginIn: Math.abs(Number(r.marginIn)), challenged: r.challenge !== null }] : []));

/**
 * The rows split between two shards by game, the doubleheader in the first. Each keeps exactly eight of the close calls
 * Another ten may deal, one of them challenged, so it deals one ten and then runs dry.
 */
function splitInTwo(rows: readonly Cells[]): Cells[][] {
  const first = new Set<unknown>([GAMES[0].row[0], GAMES[1].row[0]]);

  return [rows.filter((r) => first.has(r.gamePk)), rows.filter((r) => !first.has(r.gamePk))].map((part, i) => {
    const close = cardsOf(part, false).filter((c) => c.absMarginIn <= CLOSE_IN);
    const challenged = close.find((c) => c.challenged);
    const keep = new Set([challenged?.id, ...close.filter((c) => c !== challenged).slice(0, 7).map((c) => c.id)]);
    const kept = part.filter((r) => keep.has(idOf(r)) || !close.some((c) => c.id === idOf(r)));
    const piles = pilesOf(cardsOf(kept, false));

    if (!challenged || piles.close.length !== 8 || !dealTen(piles, mulberry32(1))) throw new Error(`season-mini: shard ${i} can't deal exactly one ten`);

    return kept;
  });
}

/** The tables a set of rows names, trimmed to just those, as a month file keeps them. */
function tablesFor(rows: readonly Cells[]) {
  const gamePks = new Set(rows.map((r) => r.gamePk));
  const games = GAMES.filter((g) => gamePks.has(g.row[0])).map((g) => [...g.row]);
  const venueIds = new Set<unknown>(games.map((g) => g[8]));
  const umpireIds = new Set(rows.map((r) => r.umpire));
  const playerIds = new Set(rows.flatMap((r) => [r.batter, r.pitcher, ...(Array.isArray(r.challenge) ? [r.challenge[0]] : [])]));
  const players = [
    ...BATTERS.map(([id, name, heightIn]) => [id, name, heightIn]),
    ...PITCHERS.map(([id, name]) => [id, name, null]),
    ...CATCHERS.map(([id, name]) => [id, name, null]),
  ];

  return {
    fields: { games: GAME_FIELDS, venues: NAME_FIELDS, umpires: NAME_FIELDS, players: PLAYER_FIELDS, pitches: PITCH_FIELDS, challenge: CHALLENGE_FIELDS },
    pitchTypes: Object.fromEntries(TYPE_CODES.map((c) => [c, [TYPES[c].name, TYPES[c].family]])),
    games,
    venues: VENUES.filter(([id]) => venueIds.has(id)),
    umpires: UMPIRES.filter(([id]) => umpireIds.has(id)),
    players: players.filter(([id]) => playerIds.has(id)),
    pitches: rows.map((r) => PITCH_FIELDS.map((f) => r[f])),
  };
}

const head = (format: string, build: string) => ({ format, version: FORMAT_VERSION, season: SEASON, build, credit: CREDIT, truthNote: TRUTH_NOTE });

/** Every date from the first to the last, both included, counted in UTC so the machine's time zone can't move them. */
function datesBetween(first: string, last: string): string[] {
  const dates: string[] = [];

  for (const day = new Date(`${first}T12:00:00Z`); ; day.setUTCDate(day.getUTCDate() + 1)) {
    const key = day.toISOString().slice(0, 10);

    dates.push(key);
    if (key === last) return dates;
  }
}

export function seasonMini({ shards: count = 1, calendar = false }: SeasonMiniOptions = {}): SeasonMini {
  const parts = count === 2 ? splitInTwo(pitchRows()) : [pitchRows()];
  const rows = parts.flat();
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  const reserve = cardsOf(rows, true);
  const ten = dealTen(pilesOf(reserve), mulberry32(1114));

  if (!ten) {
    const piles = pilesOf(reserve);

    throw new Error(`season-mini: the reserve can't deal a ten from ${reserve.length} pitches: ${Object.entries(piles).map(([k, v]) => `${k} ${v.length}`).join(', ')}`);
  }
  const tenIds = ten.map((c) => c.id);
  const otherIds = reserve.map((c) => c.id).filter((id) => !tenIds.includes(id)).slice(0, 10);
  const agree = rows.filter((r) => r.ump === r.abs).length;
  const stats = { umpVsAbs: { overall: { agree, total: rows.length, pct: round((100 * agree) / rows.length, 2) } } };
  // the build id hashes the shards' and the stats' content before any of them is stamped with it
  const build = sha256([...parts.map(tablesFor), stats]).slice(0, 12);
  const shards = parts.map((part, i) => {
    const body = { ...head(SHARD_FORMAT, build), shard: i, shards: parts.length, ...tablesFor(part) };

    return { file: `shards/${String(i).padStart(2, '0')}.json`, body, sha: sha256(body), part };
  });
  const date = '2026-11-14';
  const unavailableDate = '2026-11-15';
  const dates = calendar ? datesBetween('2026-11-01', '2026-12-01') : [date, unavailableDate];
  // A date's ten is dealt with its month and day as the seed, 1114 for the date, so it keeps the ten it has without the
  // calendar.
  const days = new Map(dates.filter((d) => d !== unavailableDate).map((d): [string, string[]] => {
    const dealt = d === date ? ten : dealTen(pilesOf(reserve), mulberry32(Number(d.slice(5).replace('-', ''))));

    if (!dealt) throw new Error(`season-mini: the reserve can't deal a ten for ${d}`);

    return [d, dealt.map((c) => c.id)];
  }));
  const monthFiles = [...new Set(dates.map((d) => d.slice(0, 7)))].map((month) => {
    const inMonth = dates.filter((d) => d.startsWith(month));
    const ids = [...new Set(inMonth.flatMap((d) => days.get(d) ?? []))];
    const body = {
      ...head(DAILY_FORMAT, build),
      month,
      ...tablesFor(ids.map((id) => byId.get(id) as Cells)),
      days: Object.fromEntries(inMonth.map((d) => [d, d === unavailableDate ? { ids: otherIds, available: false, missing: [otherIds[3]] } : { ids: days.get(d), available: true }])),
    };

    return { month, file: `daily/${month}.json`, body };
  });
  const last = dates[dates.length - 1] ?? unavailableDate;
  const manifest = {
    ...head(MANIFEST_FORMAT, build),
    daily: {
      first: dates[0],
      last,
      servedThrough: last,
      reserve: { share: 0.25, pitches: reserve.length },
      files: monthFiles.map(({ month, file, body }) => ({ month, file, bytes: JSON.stringify(body).length, sha256: sha256(body) })),
    },
    shards: shards.map(({ file, body, sha, part }) => ({ file, pitches: part.length, dealable: part.filter((r) => r.dealable).length, bytes: JSON.stringify(body).length, sha256: sha })),
  };
  const labels = new Map<unknown, string>(GAMES.map((g) => [g.row[0], g.label]));
  const served = shards.map(({ file, sha, part }) => ({ url: `${file}?v=${sha.slice(0, 12)}`, deckIds: cardsOf(part, false).map((c) => c.id) }));
  const [first] = served;

  if (!first) throw new Error('season-mini: no shard');

  return {
    files: new Map<string, Record<string, unknown>>([
      ['manifest.json', manifest],
      ...shards.map(({ file, body }): [string, Record<string, unknown>] => [file, body]),
      ...monthFiles.map(({ file, body }): [string, Record<string, unknown>] => [file, body]),
      ['stats.json', { ...head(STATS_FORMAT, build), ...stats }],
    ]),
    build,
    first: dates[0] ?? date,
    last,
    date,
    ten: tenIds.map((id) => {
      const r = byId.get(id) as Cells;

      return { id, abs: r.abs as 'S' | 'B', ump: r.ump as 'S' | 'B', label: labels.get(r.gamePk) ?? '', balls: Number(r.balls), strikes: Number(r.strikes) };
    }),
    days,
    unavailableDate,
    shardUrl: first.url,
    deckIds: first.deckIds,
    shards: served,
  };
}
