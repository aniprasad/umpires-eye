import { TRAJ_KEYS, type Traj } from './physics.ts';
import type { Call, Side } from './plays.ts';

export interface ShardDoc {
  format: string;
  version: number;
  season: number;
  shard: number;
  shards: number;
  credit: string;
  truthNote: string;
  fields: { games: string[]; venues: string[]; umpires: string[]; players: string[]; pitches: string[]; challenge: string[] };
  pitchTypes: Record<string, [string, string]>;
  games: unknown[][];
  venues: unknown[][];
  umpires: unknown[][];
  players: unknown[][];
  pitches: unknown[][];
}

export interface StoredChallenge {
  by: number;
  team: string;
  role: 'B' | 'P' | 'C';
  overturned: boolean;
}

export interface StoredPitch {
  id: string;
  gamePk: number;
  atBat: number;
  pitch: number;
  inning: number;
  top: boolean;
  outs: number;
  balls: number;
  strikes: number;
  awayScore: number;
  homeScore: number;
  bases: number;
  batter: number;
  bats: Side;
  pitcher: number;
  throws: Side;
  umpire: number | null;
  type: string | null;
  mph: number | null;
  traj: Traj;
  extension: number | null;
  zoneTop: number;
  zoneBottom: number;
  ump: Call;
  final: Call;
  abs: Call;
  marginIn: number;
  dealable: boolean;
  challenge: StoredChallenge | null;
}

export interface StoredGame {
  gamePk: number;
  date: string;
  start: string;
  gameType: string;
  away: string;
  home: string;
  series: string | null;
  seriesGame: number | null;
  venue: number | null;
}

// Rows are read by field name, so a reader keeps working if a later version adds or reorders fields.
function columns(fields: readonly string[]): (row: readonly unknown[], name: string) => unknown {
  const at = new Map(fields.map((f, i) => [f, i]));

  return (row, name) => {
    const k = at.get(name);

    if (k === undefined) throw new Error(`no field ${name}`);

    return row[k];
  };
}

export function decodeGames(doc: ShardDoc): StoredGame[] {
  const col = columns(doc.fields.games);

  return doc.games.map((row) => {
    const get = (name: string): unknown => col(row, name);

    return {
      gamePk: get('gamePk') as number,
      date: get('date') as string,
      start: get('start') as string,
      gameType: get('gameType') as string,
      away: get('away') as string,
      home: get('home') as string,
      series: get('series') as string | null,
      seriesGame: get('seriesGame') as number | null,
      venue: get('venue') as number | null,
    };
  });
}

// Venue and plate umpire names by id.
export function decodeNames(doc: ShardDoc, table: 'venues' | 'umpires'): Map<number, string> {
  const col = columns(doc.fields[table]);

  return new Map(doc[table].map((row) => [col(row, 'id') as number, col(row, 'name') as string]));
}

export function decodePlayers(doc: ShardDoc): Map<number, { name: string; heightIn: number | null }> {
  const col = columns(doc.fields.players);

  return new Map(
    doc.players.map((row) => [col(row, 'id') as number, { name: col(row, 'name') as string, heightIn: col(row, 'heightIn') as number | null }]),
  );
}

export function decodePitches(doc: ShardDoc): StoredPitch[] {
  const col = columns(doc.fields.pitches);
  const challengeCol = columns(doc.fields.challenge);

  return doc.pitches.map((row) => {
    const get = (name: string): unknown => col(row, name);
    const c = get('challenge') as unknown[] | null;
    const traj = {} as Traj;

    for (const k of TRAJ_KEYS) traj[k] = get(k) as number;

    const challenge = c ? (name: string): unknown => challengeCol(c, name) : null;

    return {
      id: `${get('gamePk')}-${get('atBat')}-${get('pitch')}`,
      gamePk: get('gamePk') as number,
      atBat: get('atBat') as number,
      pitch: get('pitch') as number,
      inning: get('inning') as number,
      top: get('top') === 1,
      outs: get('outs') as number,
      balls: get('balls') as number,
      strikes: get('strikes') as number,
      awayScore: get('awayScore') as number,
      homeScore: get('homeScore') as number,
      bases: get('bases') as number,
      batter: get('batter') as number,
      bats: get('bats') as Side,
      pitcher: get('pitcher') as number,
      throws: get('throws') as Side,
      umpire: get('umpire') as number | null,
      type: get('type') as string | null,
      mph: get('mph') as number | null,
      traj,
      extension: get('extension') as number | null,
      zoneTop: get('zoneTop') as number,
      zoneBottom: get('zoneBottom') as number,
      ump: get('ump') as Call,
      final: get('final') as Call,
      abs: get('abs') as Call,
      marginIn: get('marginIn') as number,
      dealable: get('dealable') === 1,
      challenge: challenge
        ? {
            by: challenge('by') as number,
            team: challenge('team') as string,
            role: challenge('role') as 'B' | 'P' | 'C',
            overturned: challenge('overturned') === 1,
          }
        : null,
    };
  });
}
