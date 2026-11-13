import { absJudge, crossing, inDealBox, TRAJ_KEYS, type Traj } from './physics.ts';
import type { Judged } from './judge.ts';
import type { Role } from './plays.ts';
import type { Game } from './schedule.ts';

export const FORMAT_VERSION = 1;
export const SHARD_FORMAT = 'umpires-eye.season-shard';
export const MANIFEST_FORMAT = 'umpires-eye.season-manifest';
export const STATS_FORMAT = 'umpires-eye.season-stats';

export const GAME_FIELDS = ['gamePk', 'date', 'start', 'gameType', 'away', 'home', 'series', 'seriesGame', 'venue'] as const;
export const NAME_FIELDS = ['id', 'name'] as const;
export const PLAYER_FIELDS = ['id', 'name', 'heightIn'] as const;
export const CHALLENGE_FIELDS = ['by', 'team', 'role', 'overturned'] as const;
export const PITCH_FIELDS = [
  'gamePk',
  'atBat',
  'pitch',
  'inning',
  'top',
  'outs',
  'balls',
  'strikes',
  'awayScore',
  'homeScore',
  'bases',
  'batter',
  'bats',
  'pitcher',
  'throws',
  'umpire',
  'type',
  'mph',
  ...TRAJ_KEYS,
  'extension',
  'zoneTop',
  'zoneBottom',
  'ump',
  'final',
  'abs',
  'marginIn',
  'dealable',
  'challenge',
] as const;

export type Family = 'fastball' | 'breaking' | 'offspeed' | 'other';
export type Cell = string | number | null | Cell[];
export type Row = Cell[];

export const ROLE_CODE: Record<Role, 'B' | 'P' | 'C'> = { batter: 'B', pitcher: 'P', catcher: 'C' };

const FAMILY: Record<string, Family> = {
  FF: 'fastball',
  SI: 'fastball',
  FC: 'fastball',
  FT: 'fastball',
  FA: 'fastball',
  SL: 'breaking',
  ST: 'breaking',
  SV: 'breaking',
  CU: 'breaking',
  KC: 'breaking',
  CS: 'breaking',
  CH: 'offspeed',
  FS: 'offspeed',
  FO: 'offspeed',
  SC: 'offspeed',
};

export function familyOf(code: string | null): Family {
  return (code && FAMILY[code]) || 'other';
}

export function round(v: number, decimals: number): number {
  const k = 10 ** decimals;

  return Math.round(v * k) / k;
}

export function roundTraj(tr: Traj, decimals: number): Traj {
  const out = {} as Traj;

  for (const k of TRAJ_KEYS) out[k] = round(tr[k], decimals);

  return out;
}

export interface Quantized {
  traj: Traj;
  zoneTop: number;
  zoneBottom: number;
  decimals: number | null;
}

const LEVELS = [4, 5, 6, 8];

// Four decimals is plenty for drawing, but a pitch a hair from the edge can flip when its inputs are rounded. Such a
// pitch keeps more decimals, so recomputing from what is stored always reproduces the stored truth and dealable flag.
export function quantize(j: Judged): Quantized {
  for (const d of LEVELS) {
    const traj = roundTraj(j.p.traj, d);
    const zoneTop = round(j.p.zoneTop, d);
    const zoneBottom = round(j.p.zoneBottom, d);
    const mid = crossing(traj);
    const k = absJudge(mid.x, mid.z, zoneTop, zoneBottom);

    if (k.strike === (j.truth === 'S') && inDealBox(mid) === j.inBox) return { traj, zoneTop, zoneBottom, decimals: d };
  }

  return { traj: { ...j.p.traj }, zoneTop: j.p.zoneTop, zoneBottom: j.p.zoneBottom, decimals: null };
}

// The venue is an id here; its name is in the shard's venues table.
export function gameRow(g: Game, teamAbbr: (id: number) => string): Row {
  return [
    g.gamePk,
    g.date,
    g.start,
    g.gameType,
    teamAbbr(g.awayId),
    teamAbbr(g.homeId),
    g.series,
    g.seriesGame,
    g.venue?.id ?? null,
  ];
}

export function pitchRow(j: Judged, q: Quantized, dealable: boolean, teamAbbr: (id: number) => string): Row {
  const p = j.p;
  const c = p.challenge;

  return [
    p.gamePk,
    p.atBat,
    p.pitch,
    p.inning,
    p.top ? 1 : 0,
    p.outs,
    p.balls,
    p.strikes,
    p.awayScore,
    p.homeScore,
    p.bases,
    p.batterId,
    p.bats,
    p.pitcherId,
    p.throws,
    p.umpireId,
    p.pitchType,
    p.mph === null ? null : round(p.mph, 1),
    ...TRAJ_KEYS.map((k) => q.traj[k]),
    p.extension === null ? null : round(p.extension, 2),
    q.zoneTop,
    q.zoneBottom,
    p.umpCall,
    p.finalCall,
    j.truth,
    round(j.marginIn, 2),
    dealable ? 1 : 0,
    c ? [c.byId, teamAbbr(c.teamId), ROLE_CODE[c.role], c.overturned ? 1 : 0] : null,
  ];
}

// One row per line keeps the files diffable; gzip makes the repeated punctuation nearly free.
export function rowsJson(head: Record<string, unknown>, tables: Array<[string, readonly Row[]]>): string {
  const parts = [JSON.stringify(head).slice(0, -1)];

  for (const [name, rows] of tables) {
    parts.push(`,\n${JSON.stringify(name)}:[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]`);
  }

  return `${parts.join('')}}\n`;
}
