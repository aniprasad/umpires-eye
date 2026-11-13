import type { Family, RoleCode, Row } from '../../../src/core/schema.ts';
import { absJudge, crossing, inDealBox, quickEnough, TRAJ_KEYS, type Traj } from './physics.ts';
import type { Judged } from './judge.ts';
import type { Role } from './plays.ts';
import type { Game } from './schedule.ts';

// The formats and field lists are core's, shared with the app's reader.
export {
  CHALLENGE_FIELDS,
  FORMAT_VERSION,
  GAME_FIELDS,
  MANIFEST_FORMAT,
  NAME_FIELDS,
  PITCH_FIELDS,
  PLAYER_FIELDS,
  SHARD_FORMAT,
  STATS_FORMAT,
  type Cell,
  type Family,
  type Row,
} from '../../../src/core/schema.ts';

export const ROLE_CODE: Record<Role, RoleCode> = { batter: 'B', pitcher: 'P', catcher: 'C' };

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
  extension: number | null;
  decimals: number | null;
}

const LEVELS = [4, 5, 6, 8];

// Four decimals is plenty for drawing, but a pitch a hair from an edge can flip when its inputs are rounded. Such a
// pitch keeps more decimals, so recomputing from what is stored always reproduces the stored truth, the crossing box
// and the flight-time bound. Extension, a release distance, keeps two decimals fewer than the trajectory.
export function quantize(j: Judged): Quantized {
  const ext = j.p.extension;
  const quick = ext !== null && quickEnough(j.p.traj, ext);

  for (const d of LEVELS) {
    const traj = roundTraj(j.p.traj, d);
    const zoneTop = round(j.p.zoneTop, d);
    const zoneBottom = round(j.p.zoneBottom, d);
    const extension = ext === null ? null : round(ext, d - 2);
    const mid = crossing(traj);
    const k = absJudge(mid.x, mid.z, zoneTop, zoneBottom);
    const stillQuick = extension !== null && quickEnough(traj, extension);

    if (k.strike === (j.truth === 'S') && inDealBox(mid) === j.inBox && stillQuick === quick) {
      return { traj, zoneTop, zoneBottom, extension, decimals: d };
    }
  }

  return { traj: { ...j.p.traj }, zoneTop: j.p.zoneTop, zoneBottom: j.p.zoneBottom, extension: ext, decimals: null };
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
    q.extension,
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
