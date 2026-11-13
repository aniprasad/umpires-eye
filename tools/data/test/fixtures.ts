import { flightTime, tAtY, type Traj } from '../../../src/core/kinematics.ts';
import { BALL_R, MID_Y, PLATE_HALF } from '../../../src/core/rules.ts';
import type { Judged } from '../lib/judge.ts';
import type { Play, PlayEvent, Review, Runner } from '../lib/mlb.ts';
import type { Person } from '../lib/people.ts';
import type { Call, CalledPitch, Side } from '../lib/plays.ts';
import type { Game } from '../lib/schedule.ts';

export const ZONE = { top: 3.4, bottom: 1.6 };
export const AWAY = 1;
export const HOME = 2;
export const GAME: Game = {
  gamePk: 900001,
  date: '2026-05-01',
  start: '2026-05-01T23:05:00Z',
  gameType: 'R',
  awayId: AWAY,
  homeId: HOME,
  series: null,
  seriesGame: null,
  venue: null,
  scheduledUmpire: null,
};

// A fastball-like fit (t = 0 at y0 = 50 ft) that crosses mid-plate exactly at (x, z).
export function trajThrough(x: number, z: number): Traj {
  const base = { y0: 50, vY0: -130, aY: 28, vX0: 0, aX: 0, vZ0: -5, aZ: -16 };
  const t = tAtY({ ...base, x0: 0, z0: 0 }, MID_Y);

  return { ...base, x0: x, z0: z - base.vZ0 * t - 0.5 * base.aZ * t * t };
}

// The crossing x at mid-height of ZONE that puts the ball marginIn from flipping (positive inside, as for strikes).
export function xForMargin(marginIn: number): number {
  return PLATE_HALF + BALL_R - marginIn / 12;
}

export interface PitchSpec {
  code: string;
  after: [number, number];
  outs?: number;
  x?: number;
  z?: number;
  tracked?: boolean;
  description?: string;
  review?: Review;
}

export function pitch(index: number, pitchNumber: number, spec: PitchSpec): PlayEvent {
  const x = spec.x ?? 0;
  const z = spec.z ?? 2.5;
  const description = spec.description ?? (spec.code === 'C' ? 'Called Strike' : spec.code === 'B' ? 'Ball' : spec.code);

  return {
    index,
    pitchNumber,
    isPitch: true,
    type: 'pitch',
    details: { call: { code: spec.code, description }, code: spec.code, description, type: { code: 'FF', description: 'Four-Seam Fastball' } },
    count: { balls: spec.after[0], strikes: spec.after[1], outs: spec.outs ?? 0 },
    pitchData:
      spec.tracked === false
        ? { startSpeed: 95 }
        : {
            startSpeed: 95.1,
            extension: 6.5,
            strikeZoneTop: ZONE.top,
            strikeZoneBottom: ZONE.bottom,
            coordinates: { ...trajThrough(x, z), pX: x, pZ: z },
          },
    ...(spec.review ? { reviewDetails: spec.review } : {}),
  };
}

export function action(index: number, eventType: string, extra: Partial<PlayEvent> = {}): PlayEvent {
  return { index, isPitch: false, type: 'action', details: { eventType, description: eventType }, ...extra };
}

// Automatic balls and strikes are no_pitch events that move the count.
export function noPitch(index: number, code: string, description: string, after: [number, number]): PlayEvent {
  return {
    index,
    isPitch: false,
    type: 'no_pitch',
    details: { call: { code, description }, code, description },
    count: { balls: after[0], strikes: after[1], outs: 0 },
  };
}

export function runner(id: number, start: string | null, end: string | null, playIndex: number, isOut = false): Runner {
  return { movement: { start, end, isOut }, details: { runner: { id }, playIndex } };
}

export interface PlaySpec {
  atBat: number;
  inning?: number;
  top?: boolean;
  batter?: number;
  pitcher?: number;
  bats?: string;
  throws?: string;
  outs?: number;
  score?: [number, number];
  events: PlayEvent[];
  runners?: Runner[];
  post?: { first?: number; second?: number; third?: number };
  review?: Review;
}

export function play(s: PlaySpec): Play {
  const batter = s.batter ?? 11;
  const pitcher = s.pitcher ?? 20;

  return {
    atBatIndex: s.atBat,
    about: { atBatIndex: s.atBat, inning: s.inning ?? 1, isTopInning: s.top ?? true, halfInning: (s.top ?? true) ? 'top' : 'bottom' },
    result: { event: 'Groundout', awayScore: s.score?.[0] ?? 0, homeScore: s.score?.[1] ?? 0 },
    count: { balls: 0, strikes: 0, outs: s.outs ?? 0 },
    matchup: {
      batter: { id: batter, fullName: `Batter ${batter}` },
      batSide: { code: s.bats ?? 'R' },
      pitcher: { id: pitcher, fullName: `Pitcher ${pitcher}` },
      pitchHand: { code: s.throws ?? 'R' },
      ...(s.post?.first ? { postOnFirst: { id: s.post.first } } : {}),
      ...(s.post?.second ? { postOnSecond: { id: s.post.second } } : {}),
      ...(s.post?.third ? { postOnThird: { id: s.post.third } } : {}),
    },
    runners: s.runners ?? [],
    playEvents: s.events,
    ...(s.review ? { reviewDetails: s.review } : {}),
  };
}

export function challenge(by: number, teamId: number, overturned: boolean, reviewType = 'MJ'): Review {
  return { reviewType, isOverturned: overturned, inProgress: false, challengeTeamId: teamId, player: { id: by, fullName: `Player ${by}` } };
}

export function person(id: number, extra: Partial<Person> = {}): Person {
  return { id, name: `Player ${id}`, heightIn: 74, bats: 'R', throws: 'R', position: 'CF', ...extra };
}

export function peopleOf(...people: Person[]): Map<number, Person> {
  return new Map(people.map((p) => [p.id, p]));
}

export interface JudgedSpec {
  seq: number;
  marginIn: number;
  bats?: Side;
  challenged?: boolean;
  inBox?: boolean;
  showable?: boolean;
  pitchType?: string;
  team?: number;
}

// A judged pitch with only the fields the pool, shards and dealer look at filled in meaningfully.
export function judged(s: JudgedSpec): Judged {
  const truth: Call = s.marginIn >= 0 ? 'S' : 'B';
  const p: CalledPitch = {
    id: `900001-${s.seq}-1`,
    gamePk: GAME.gamePk,
    atBat: s.seq,
    pitch: 1,
    inning: 1,
    top: true,
    outs: 0,
    balls: 0,
    strikes: 0,
    awayScore: 0,
    homeScore: 0,
    bases: 0,
    batterId: 11,
    batterName: 'Batter 11',
    bats: s.bats ?? 'R',
    pitcherId: 20,
    pitcherName: 'Pitcher 20',
    throws: 'R',
    umpireId: 70,
    pitchingTeamId: s.team ?? HOME,
    attribution: 'matchup',
    pitchType: s.pitchType ?? 'FF',
    pitchTypeName: 'Four-Seam Fastball',
    mph: 95,
    extension: 6.5,
    traj: trajThrough(xForMargin(s.marginIn), 2.5),
    zoneTop: ZONE.top,
    zoneBottom: ZONE.bottom,
    pX: null,
    pZ: null,
    umpCall: truth,
    finalCall: truth,
    challenge: s.challenged ? { byId: 30, byName: 'Player 30', teamId: HOME, role: 'catcher', overturned: false, source: 'pitch' } : null,
  };

  return {
    p,
    seq: s.seq,
    mid: { x: xForMargin(s.marginIn), y: MID_Y, z: 2.5 },
    truth,
    marginIn: s.marginIn,
    inBox: s.inBox ?? true,
    flightS: flightTime(p.traj, 6.5),
    showable: s.showable ?? true,
  };
}
