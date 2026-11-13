// Shards (and the daily month files, which hold the same tables) to records. Columns are read by field name, so a
// reader keeps working if a later version adds or reorders fields. Every cell is checked as it's read: a file that
// doesn't match the format throws a DecodeError that names the table, row and field, rather than letting a missing
// or malformed value reach the game.
import type { Traj } from './kinematics.ts';
import {
  CHALLENGE_FIELDS,
  FAMILIES,
  FORMAT_VERSION,
  GAME_FIELDS,
  NAME_FIELDS,
  PITCH_FIELDS,
  PLAYER_FIELDS,
  type CallCode,
  type Family,
  type RoleCode,
  type Side,
  type StoredChallenge,
  type StoredGame,
  type StoredPitch,
  type StoredPlayer,
} from './schema.ts';

export class DecodeError extends Error {
  override name = 'DecodeError';
}

/** Every table of a shard or month file, decoded, with the references between them checked. */
export interface DecodedTables {
  games: StoredGame[];
  venues: Map<number, string>;
  umpires: Map<number, string>;
  players: Map<number, StoredPlayer>;
  pitchTypes: Map<string, { name: string; family: Family }>;
  pitches: StoredPitch[];
}

type Doc = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown): string => (v === undefined ? 'missing' : typeof v === 'number' ? String(v) : JSON.stringify(v));

function asDoc(doc: unknown): Doc {
  if (!isRecord(doc)) throw new DecodeError("the file isn't a JSON object");

  return doc;
}

/** Where each named column sits, after checking the file names every column the reader needs, once each. */
function columns(doc: Doc, key: string, needed: readonly string[]): Map<string, number> {
  const list = isRecord(doc.fields) ? doc.fields[key] : undefined;
  const at = new Map<string, number>();

  if (!Array.isArray(list)) throw new DecodeError(`fields.${key} is missing`);
  for (const [i, name] of list.entries()) {
    if (typeof name !== 'string' || at.has(name)) throw new DecodeError(`fields.${key} has a bad or repeated name at ${i}: ${show(name)}`);
    at.set(name, i);
  }
  for (const name of needed) if (!at.has(name)) throw new DecodeError(`fields.${key} has no ${name}`);

  return at;
}

function rowsOf(doc: Doc, table: string): readonly unknown[] {
  const rows = doc[table];

  if (!Array.isArray(rows)) throw new DecodeError(`the ${table} table is missing`);

  return rows;
}

/** Typed reads from one row; each throws, naming the row and field, when the cell isn't what the format says. */
function cellsOf(where: string, row: unknown, at: ReadonlyMap<string, number>) {
  if (!Array.isArray(row)) throw new DecodeError(`${where} isn't a list of cells`);

  const get = (name: string): unknown => row[at.get(name) ?? -1];
  const bad = (name: string, want: string): never => {
    throw new DecodeError(`${where}: ${name} is ${show(get(name))}, not ${want}`);
  };
  const int = (name: string): number => {
    const v = get(name);

    return typeof v === 'number' && Number.isInteger(v) ? v : bad(name, 'an integer');
  };
  const num = (name: string): number => {
    const v = get(name);

    return typeof v === 'number' && Number.isFinite(v) ? v : bad(name, 'a finite number');
  };
  const str = (name: string): string => {
    const v = get(name);

    return typeof v === 'string' ? v : bad(name, 'a string');
  };
  const orNull = <T>(read: (name: string) => T) => (name: string): T | null => (get(name) === null ? null : read(name));

  return {
    get,
    int,
    num,
    str,
    intOrNull: orNull(int),
    numOrNull: orNull(num),
    strOrNull: orNull(str),
    flag: (name: string): boolean => {
      const v = get(name);

      return v === 1 ? true : v === 0 ? false : bad(name, '0 or 1');
    },
    side: (name: string): Side => {
      const v = get(name);

      return v === 'L' || v === 'R' ? v : bad(name, 'L or R');
    },
    call: (name: string): CallCode => {
      const v = get(name);

      return v === 'S' || v === 'B' ? v : bad(name, 'S or B');
    },
    role: (name: string): RoleCode => {
      const v = get(name);

      return v === 'B' || v === 'P' || v === 'C' ? v : bad(name, 'B, P or C');
    },
  };
}

export function decodeGames(doc: object): StoredGame[] {
  const d = asDoc(doc);
  const at = columns(d, 'games', GAME_FIELDS);
  const seen = new Set<number>();

  return rowsOf(d, 'games').map((row, i) => {
    const where = `games row ${i}`;
    const c = cellsOf(where, row, at);
    const gamePk = c.int('gamePk');

    if (seen.has(gamePk)) throw new DecodeError(`${where}: gamePk ${gamePk} appears twice`);
    seen.add(gamePk);

    return {
      gamePk,
      date: c.str('date'),
      start: c.str('start'),
      gameType: c.str('gameType'),
      away: c.str('away'),
      home: c.str('home'),
      series: c.strOrNull('series'),
      seriesGame: c.intOrNull('seriesGame'),
      venue: c.intOrNull('venue'),
    };
  });
}

/** A table's rows by id. An id that comes twice is refused: a reference to it would quietly get the later row. */
function byId<T>(table: string, rows: readonly unknown[], read: (where: string, row: unknown) => [number, T]): Map<number, T> {
  const out = new Map<number, T>();

  for (const [i, row] of rows.entries()) {
    const where = `${table} row ${i}`;
    const [id, value] = read(where, row);

    if (out.has(id)) throw new DecodeError(`${where}: id ${id} appears twice`);
    out.set(id, value);
  }

  return out;
}

/** Venue or plate umpire names by id. */
export function decodeNames(doc: object, table: 'venues' | 'umpires'): Map<number, string> {
  const d = asDoc(doc);
  const at = columns(d, table, NAME_FIELDS);

  return byId(table, rowsOf(d, table), (where, row) => {
    const c = cellsOf(where, row, at);

    return [c.int('id'), c.str('name')];
  });
}

export function decodePlayers(doc: object): Map<number, StoredPlayer> {
  const d = asDoc(doc);
  const at = columns(d, 'players', PLAYER_FIELDS);

  return byId('players', rowsOf(d, 'players'), (where, row) => {
    const c = cellsOf(where, row, at);

    return [c.int('id'), { name: c.str('name'), heightIn: c.numOrNull('heightIn') }];
  });
}

export function decodePitches(doc: object): StoredPitch[] {
  const d = asDoc(doc);
  const at = columns(d, 'pitches', PITCH_FIELDS);
  const challengeAt = columns(d, 'challenge', CHALLENGE_FIELDS);

  return rowsOf(d, 'pitches').map((row, i) => {
    const where = `pitches row ${i}`;
    const c = cellsOf(where, row, at);
    const traj: Traj = {
      x0: c.num('x0'),
      y0: c.num('y0'),
      z0: c.num('z0'),
      vX0: c.num('vX0'),
      vY0: c.num('vY0'),
      vZ0: c.num('vZ0'),
      aX: c.num('aX'),
      aY: c.num('aY'),
      aZ: c.num('aZ'),
    };
    const gamePk = c.int('gamePk');
    const atBat = c.int('atBat');
    const pitch = c.int('pitch');
    const cell = c.get('challenge');
    let challenge: StoredChallenge | null = null;

    if (cell !== null) {
      const ch = cellsOf(`${where} challenge`, cell, challengeAt);

      challenge = { by: ch.int('by'), team: ch.str('team'), role: ch.role('role'), overturned: ch.flag('overturned') };
    }

    return {
      id: `${gamePk}-${atBat}-${pitch}`,
      gamePk,
      atBat,
      pitch,
      inning: c.int('inning'),
      top: c.flag('top'),
      outs: c.int('outs'),
      balls: c.int('balls'),
      strikes: c.int('strikes'),
      awayScore: c.int('awayScore'),
      homeScore: c.int('homeScore'),
      bases: c.int('bases'),
      batter: c.int('batter'),
      bats: c.side('bats'),
      pitcher: c.int('pitcher'),
      throws: c.side('throws'),
      umpire: c.intOrNull('umpire'),
      type: c.strOrNull('type'),
      mph: c.numOrNull('mph'),
      traj,
      extension: c.numOrNull('extension'),
      zoneTop: c.num('zoneTop'),
      zoneBottom: c.num('zoneBottom'),
      ump: c.call('ump'),
      final: c.call('final'),
      abs: c.call('abs'),
      marginIn: c.num('marginIn'),
      dealable: c.flag('dealable'),
      challenge,
    };
  });
}

/** A pitch type code's name and family. */
export function decodePitchTypes(doc: object): Map<string, { name: string; family: Family }> {
  const types = asDoc(doc).pitchTypes;

  if (!isRecord(types)) throw new DecodeError('pitchTypes is missing');

  return new Map(
    Object.entries(types).map(([code, v]) => {
      const pair: readonly unknown[] = Array.isArray(v) ? v : [];
      const name = pair[0];
      const family = FAMILIES.find((f) => f === pair[1]);

      if (typeof name !== 'string' || !family) throw new DecodeError(`pitchTypes.${code} is ${show(v)}, not a name and a family`);

      return [code, { name, family }];
    }),
  );
}

/**
 * A whole shard or month file: its format and version, every table, and every reference between them. Each pitch's
 * game, players, plate umpire and pitch type, and each game's venue, are in their tables, and no game, venue, umpire,
 * player or pitch appears twice.
 */
export function decodeTables(doc: unknown, format: string): DecodedTables {
  const d = asDoc(doc);

  if (d.format !== format) throw new DecodeError(`the format is ${show(d.format)}, not ${format}`);
  if (d.version !== FORMAT_VERSION) throw new DecodeError(`the version is ${show(d.version)}, not ${FORMAT_VERSION}`);

  const tables: DecodedTables = {
    games: decodeGames(d),
    venues: decodeNames(d, 'venues'),
    umpires: decodeNames(d, 'umpires'),
    players: decodePlayers(d),
    pitchTypes: decodePitchTypes(d),
    pitches: decodePitches(d),
  };
  const games = new Set<number>();
  const ids = new Set<string>();

  for (const g of tables.games) {
    if (g.venue !== null && !tables.venues.has(g.venue)) throw new DecodeError(`game ${g.gamePk}: venue ${g.venue} isn't in the venues table`);
    games.add(g.gamePk);
  }
  for (const p of tables.pitches) {
    const missing = [
      games.has(p.gamePk) ? '' : `game ${p.gamePk} isn't in the games table`,
      tables.players.has(p.batter) ? '' : `batter ${p.batter} isn't in the players table`,
      tables.players.has(p.pitcher) ? '' : `pitcher ${p.pitcher} isn't in the players table`,
      !p.challenge || tables.players.has(p.challenge.by) ? '' : `challenger ${p.challenge.by} isn't in the players table`,
      p.umpire === null || tables.umpires.has(p.umpire) ? '' : `plate umpire ${p.umpire} isn't in the umpires table`,
      p.type === null || tables.pitchTypes.has(p.type) ? '' : `pitch type ${p.type} isn't in pitchTypes`,
      ids.has(p.id) ? 'it appears twice' : '',
    ].filter(Boolean);

    if (missing.length) throw new DecodeError(`pitch ${p.id}: ${missing.join('; ')}`);
    ids.add(p.id);
  }

  return tables;
}
