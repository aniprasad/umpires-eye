// The season files' rows as the game's pitches (docs/M2-DESIGN.md §4.4). Only dealable rows become pitches: the data
// tools mark a row otherwise when it lacks what the game needs to show it, or flies too slowly to stay in frame, and
// the app trusts that mark rather than deriving it again.
import type { DecodedTables } from '../core/decode.ts';
import { flightTime, posAt, releaseT, tAtY } from '../core/kinematics.ts';
import { DEAL_BOX, MID_Y } from '../core/rules.ts';
import type { CallCode, RoleCode, StoredGame, StoredPitch } from '../core/schema.ts';
import type { PlayPoint } from '../math/lens';
import type { Call, GameMeta, Pitch } from '../math/types';
import { dateLabel } from './dates';
import { LoadError } from './source';

const CALLS: Readonly<Record<CallCode, Call>> = { S: 'strike', B: 'ball' };
const ROLES: Readonly<Record<RoleCode, string>> = { B: 'batter', P: 'pitcher', C: 'catcher' };
const BASES = [[1, '1B'], [2, '2B'], [4, '3B']] as const;
/** ABS sets the top of the zone at 53.5% of the batter's height, so a missing height can come back from the zone. */
const ZONE_TOP_SHARE = 0.535;

/** How the copy names a game: by its series and number in the postseason, and by its date otherwise. */
export function gameMeta(g: StoredGame, venues: ReadonlyMap<number, string>, season: number): GameMeta {
  return {
    gamePk: g.gamePk,
    date: g.date,
    away: g.away,
    home: g.home,
    label: g.series !== null && g.seriesGame !== null ? `${season} ${g.series} · Game ${g.seriesGame}` : dateLabel(g.date),
    seriesGame: g.seriesGame,
    venue: g.venue === null ? null : (venues.get(g.venue) ?? null),
  };
}

export interface RowReader {
  /** The pitch a dealable row holds, `order` being its place in played order. Throws a data LoadError for any other row. */
  pitch(row: StoredPitch, order: number): Pitch;
}

/** Reads the rows of one decoded shard or month file. Pitches from a game share its GameMeta. */
export function rowReader(tables: DecodedTables, season: number): RowReader {
  const games = new Map(tables.games.map((g) => [g.gamePk, gameMeta(g, tables.venues, season)]));

  return {
    pitch(row, order) {
      const { traj, mph, extension, challenge } = row;
      const game = games.get(row.gamePk);
      const batter = tables.players.get(row.batter);
      const pitcher = tables.players.get(row.pitcher);
      const challenger = challenge && tables.players.get(challenge.by);
      const type = row.type === null ? undefined : tables.pitchTypes.get(row.type);
      const bad = (why: string): LoadError => new LoadError('data', `Pitch ${row.id} ${why}.`);

      if (!row.dealable) throw bad("isn't dealable");
      // a null is never read as 0: that would put the release on the rubber
      if (mph === null) throw bad('has no speed');
      if (extension === null) throw bad('has no extension');
      if (!game || !batter || !pitcher || (challenge && !challenger)) throw bad('names a game or player its file lacks');
      const tRel = releaseT(traj, extension);
      const tMid = tAtY(traj, MID_Y);
      const rel = posAt(traj, tRel);
      const mid = posAt(traj, tMid);

      return {
        id: row.id,
        gamePk: row.gamePk,
        game,
        order,
        plateUmpire: row.umpire === null ? null : (tables.umpires.get(row.umpire) ?? null),
        inning: row.inning,
        half: row.top ? 'top' : 'bottom',
        outs: row.outs,
        countBefore: { balls: row.balls, strikes: row.strikes },
        score: { away: row.awayScore, home: row.homeScore },
        runnersOn: BASES.flatMap(([bit, base]) => (row.bases & bit ? [base] : [])),
        batter: { id: row.batter, name: batter.name, side: row.bats, heightFt: batter.heightIn === null ? row.zoneTop / ZONE_TOP_SHARE : batter.heightIn / 12 },
        pitcher: { id: row.pitcher, name: pitcher.name, hand: row.throws },
        pitchType: type && row.type !== null ? { code: row.type, name: type.name, family: type.family } : { code: '', name: 'Unknown pitch', family: 'other' },
        startSpeed: mph,
        extension,
        flightTime: flightTime(traj, extension),
        traj,
        release: { x: rel.x, y: rel.y, z: rel.z, t: tRel },
        mid: { x: mid.x, z: mid.z, t: tMid },
        zone: { top: row.zoneTop, bottom: row.zoneBottom },
        absTruth: CALLS[row.abs],
        edgeMarginIn: row.marginIn,
        umpCall: CALLS[row.ump],
        finalCall: CALLS[row.final],
        umpCorrect: row.ump === row.abs,
        challenge: challenge && challenger
          ? { by: challenger.name, byId: challenge.by, byTeam: challenge.team, byRole: ROLES[challenge.role], isOverturned: challenge.overturned }
          : null,
      };
    },
  };
}

/**
 * The deal box's edges at mid-plate, every 0.1 ft (§4.6). Every dealable season pitch crosses inside the box, so a lens
 * fitted to its edges frames each one, whichever shard is loaded.
 */
export function boxLensPoints(): PlayPoint[] {
  const { xMax, zMin, zMax } = DEAL_BOX;
  const nx = Math.round((2 * xMax) / 0.1);
  const nz = Math.round((zMax - zMin) / 0.1);
  const pts: PlayPoint[] = [];

  for (let i = 0; i <= nx; i++) {
    const x = -xMax + (2 * xMax * i) / nx;

    pts.push({ x, z: zMin }, { x, z: zMax });
  }
  for (let j = 1; j < nz; j++) {
    const z = zMin + ((zMax - zMin) * j) / nz;

    pts.push({ x: -xMax, z }, { x: xMax, z });
  }

  return pts;
}
