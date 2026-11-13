import type { Traj } from '../../../src/core/kinematics.ts';
import {
  CHALLENGE_FIELDS,
  FORMAT_VERSION,
  GAME_FIELDS,
  NAME_FIELDS,
  PITCH_FIELDS,
  PLAYER_FIELDS,
  SHARD_FORMAT,
  type PitchField,
  type ShardDoc,
} from '../../../src/core/schema.ts';

export type PitchCells = Record<PitchField, unknown>;

/** A straight path that crosses mid-plate at (x, z), at `speed` ft/s all the way. */
export const trajThrough = (x: number, z: number, speed = 130): Traj => ({ x0: x, y0: 50, z0: z, vX0: 0, vY0: -speed, vZ0: 0, aX: 0, aY: 0, aZ: 0 });

/** A synthetic pitch row, by field name: a dealable called strike down the middle, 0.8 in from flipping. */
export function pitchCells(over: Partial<PitchCells> = {}): PitchCells {
  return {
    gamePk: 900001,
    atBat: 1,
    pitch: 1,
    inning: 1,
    top: 1,
    outs: 0,
    balls: 0,
    strikes: 0,
    awayScore: 0,
    homeScore: 0,
    bases: 0,
    batter: 11,
    bats: 'R',
    pitcher: 20,
    throws: 'R',
    umpire: 70,
    type: 'FF',
    mph: 95.1,
    ...trajThrough(0, 2.5),
    extension: 6.5,
    zoneTop: 3.4,
    zoneBottom: 1.6,
    ump: 'S',
    final: 'S',
    abs: 'S',
    marginIn: 0.8,
    dealable: 1,
    challenge: null,
    ...over,
  };
}

/** A synthetic shard of `pitches`, its pitch columns written in `order`. Its tables hold what the default rows name. */
export function shardDoc(pitches: readonly PitchCells[], order: readonly PitchField[] = PITCH_FIELDS): ShardDoc {
  return {
    format: SHARD_FORMAT,
    version: FORMAT_VERSION,
    season: 2026,
    shard: 0,
    shards: 1,
    credit: 'credit',
    truthNote: 'note',
    fields: { games: GAME_FIELDS, venues: NAME_FIELDS, umpires: NAME_FIELDS, players: PLAYER_FIELDS, pitches: order, challenge: CHALLENGE_FIELDS },
    pitchTypes: { FF: ['Four-Seam Fastball', 'fastball'], SL: ['Slider', 'breaking'] },
    games: [
      [900001, '2026-05-01', '2026-05-01T17:05:00Z', 'R', 'AWY', 'HOM', null, null, 32],
      [900002, '2026-05-01', '2026-05-01T23:10:00Z', 'R', 'AWY', 'HOM', null, null, 32],
    ],
    venues: [[32, 'A Park']],
    umpires: [[70, 'Plate Ump'], [71, 'Relief Ump']],
    players: [[11, 'Sam Example', 74], [20, 'Pat Sample', null], [30, 'Cal Catcher', 72]],
    pitches: pitches.map((p) => order.map((f) => p[f])),
  };
}

/** The document as the app gets it: through JSON, so it holds only what a file can. */
export const asFile = (doc: object): unknown => JSON.parse(JSON.stringify(doc));
