import { describe, expect, it } from 'vitest';
import { DecodeError, decodeTables } from '../../../src/core/decode.ts';
import { PITCH_FIELDS, SHARD_FORMAT, type ShardDoc } from '../../../src/core/schema.ts';
import { asFile, pitchCells, shardDoc } from './fixtures.ts';

const rows = [
  pitchCells(),
  pitchCells({
    atBat: 4,
    pitch: 2,
    top: 0,
    balls: 3,
    strikes: 2,
    bases: 5,
    bats: 'L',
    throws: 'L',
    umpire: null,
    type: null,
    mph: null,
    extension: null,
    final: 'B',
    abs: 'B',
    marginIn: -1.23,
    dealable: 0,
    challenge: [30, 'HOM', 'C', 1],
  }),
  pitchCells({ gamePk: 900002, umpire: 71, type: 'SL' }),
];

const decode = (doc: unknown) => decodeTables(doc, SHARD_FORMAT);
const refusal = (doc: unknown): string => {
  try {
    decode(doc);
  } catch (e) {
    expect(e).toBeInstanceOf(DecodeError);

    return (e as Error).message;
  }

  throw new Error('decoded without complaint');
};
/** The file text with one cell replaced as written, for values JSON.stringify can't produce, such as 1e999. */
const withCell = (doc: ShardDoc, marker: string, text: string): unknown => JSON.parse(JSON.stringify(doc).replace(`"${marker}"`, text));

describe('the decoder', () => {
  it('reads a shard into records', () => {
    const t = decode(asFile(shardDoc(rows)));

    expect(t.games[1]).toEqual({
      gamePk: 900002,
      date: '2026-05-01',
      start: '2026-05-01T23:10:00Z',
      gameType: 'R',
      away: 'AWY',
      home: 'HOM',
      series: null,
      seriesGame: null,
      venue: 32,
    });
    expect([t.venues.get(32), t.umpires.get(71)]).toEqual(['A Park', 'Relief Ump']);
    expect(t.players.get(20)).toEqual({ name: 'Pat Sample', heightIn: null });
    expect(t.pitchTypes.get('SL')).toEqual({ name: 'Slider', family: 'breaking' });
    expect(t.pitches.map((p) => p.id)).toEqual(['900001-1-1', '900001-4-2', '900002-1-1']);
    expect(t.pitches[1]).toEqual({
      id: '900001-4-2',
      gamePk: 900001,
      atBat: 4,
      pitch: 2,
      inning: 1,
      top: false,
      outs: 0,
      balls: 3,
      strikes: 2,
      awayScore: 0,
      homeScore: 0,
      bases: 5,
      batter: 11,
      bats: 'L',
      pitcher: 20,
      throws: 'L',
      umpire: null,
      type: null,
      mph: null,
      traj: { x0: 0, y0: 50, z0: 2.5, vX0: 0, vY0: -130, vZ0: 0, aX: 0, aY: 0, aZ: 0 },
      extension: null,
      zoneTop: 3.4,
      zoneBottom: 1.6,
      ump: 'S',
      final: 'B',
      abs: 'B',
      marginIn: -1.23,
      dealable: false,
      challenge: { by: 30, team: 'HOM', role: 'C', overturned: true },
    });
  });

  it('reads columns by name, so reordered fields give the same pitches', () => {
    expect(decode(asFile(shardDoc(rows, [...PITCH_FIELDS].reverse())))).toEqual(decode(asFile(shardDoc(rows))));
  });

  it('refuses a wrong format or version, or anything but an object, naming what it got', () => {
    expect(refusal(asFile({ ...shardDoc(rows), format: 'umpires-eye.season-manifest' }))).toBe(
      'the format is "umpires-eye.season-manifest", not umpires-eye.season-shard',
    );
    expect(refusal(asFile({ ...shardDoc(rows), version: 2 }))).toBe('the version is 2, not 1');
    expect(refusal([])).toBe("the file isn't a JSON object");
  });

  it('refuses a missing field or table, naming it', () => {
    expect(refusal(asFile(shardDoc(rows, PITCH_FIELDS.filter((f) => f !== 'mph'))))).toBe('fields.pitches has no mph');
    expect(refusal(asFile({ ...shardDoc(rows), umpires: undefined }))).toBe('the umpires table is missing');
    expect(refusal(asFile({ ...shardDoc(rows), pitchTypes: undefined }))).toBe('pitchTypes is missing');
  });

  it('refuses a cell that is not what the format says, naming its row and field', () => {
    expect(refusal(withCell(shardDoc([pitchCells(), pitchCells({ atBat: 2, x0: 'inf' })]), 'inf', '1e999'))).toBe(
      'pitches row 1: x0 is Infinity, not a finite number',
    );
    expect(refusal(asFile(shardDoc([pitchCells({ mph: '95.1' })])))).toBe('pitches row 0: mph is "95.1", not a finite number');
    expect(refusal(asFile(shardDoc([pitchCells({ zoneTop: null })])))).toBe('pitches row 0: zoneTop is null, not a finite number');
    expect(refusal(asFile(shardDoc([pitchCells({ dealable: 2 })])))).toBe('pitches row 0: dealable is 2, not 0 or 1');
    expect(refusal(asFile(shardDoc([pitchCells({ challenge: [30, 'HOM', 'X', 0] })])))).toBe('pitches row 0 challenge: role is "X", not B, P or C');
    expect(refusal(asFile({ ...shardDoc(rows), games: [[900001]] }))).toBe('games row 0: date is missing, not a string');
  });

  it("refuses a pitch whose game, players, umpire or pitch type aren't in their tables, or that appears twice", () => {
    expect(refusal(asFile(shardDoc([pitchCells({ gamePk: 900003 })])))).toBe("pitch 900003-1-1: game 900003 isn't in the games table");
    expect(refusal(asFile(shardDoc([pitchCells({ batter: 12, umpire: 72 })])))).toBe(
      "pitch 900001-1-1: batter 12 isn't in the players table; plate umpire 72 isn't in the umpires table",
    );
    expect(refusal(asFile(shardDoc([pitchCells({ pitcher: 21 })])))).toBe("pitch 900001-1-1: pitcher 21 isn't in the players table");
    expect(refusal(asFile(shardDoc([pitchCells({ type: 'KN', challenge: [31, 'HOM', 'C', 0] })])))).toBe(
      "pitch 900001-1-1: challenger 31 isn't in the players table; pitch type KN isn't in pitchTypes",
    );
    expect(refusal(asFile(shardDoc([pitchCells(), pitchCells()])))).toBe('pitch 900001-1-1: it appears twice');
  });

  it("refuses a game whose venue isn't in the venues table", () => {
    expect(refusal(asFile({ ...shardDoc(rows), venues: [] }))).toBe("game 900001: venue 32 isn't in the venues table");
  });

  it('refuses an id that appears twice in the games, venues, umpires or players table, so no reference is ambiguous', () => {
    const doc = shardDoc(rows);

    expect(refusal(asFile({ ...doc, games: [...doc.games, [900001, '2026-05-02', '2026-05-02T17:05:00Z', 'R', 'AWY', 'HOM', null, null, 32]] }))).toBe(
      'games row 2: gamePk 900001 appears twice',
    );
    expect(refusal(asFile({ ...doc, venues: [[32, 'A Park'], [32, 'Another Park']] }))).toBe('venues row 1: id 32 appears twice');
    expect(refusal(asFile({ ...doc, umpires: [...doc.umpires, [70, 'Another Ump']] }))).toBe('umpires row 2: id 70 appears twice');
    expect(refusal(asFile({ ...doc, players: [...doc.players, [11, 'Sam Other', 74]] }))).toBe('players row 3: id 11 appears twice');
  });
});
