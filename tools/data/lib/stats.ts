import { CLOSE_IN, GAME_TYPES, NEAR_IN, PLATE_FRONT_Y, type GameType } from './constants.ts';
import { round } from './format.ts';
import type { Judged } from './judge.ts';
import type { Person } from './people.ts';
import { absJudge, boxStrike, crossing, posAt, releaseT } from './physics.ts';
import type { Role } from './plays.ts';
import type { Game } from './schedule.ts';

export interface Tally {
  agree: number;
  total: number;
  pct: number;
}

export interface Spread {
  n: number;
  min: number;
  p01: number;
  p50: number;
  p99: number;
  max: number;
  mean: number;
}

export const pct = (agree: number, total: number): number => (total ? round((100 * agree) / total, 1) : 0);
export const tally = (agree: number, total: number): Tally => ({ agree, total, pct: pct(agree, total) });

export function spread(values: readonly number[], decimals = 4): Spread {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => round(s[Math.round(q * (s.length - 1))] ?? Number.NaN, decimals);
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : Number.NaN;

  return { n: s.length, min: at(0), p01: at(0.01), p50: at(0.5), p99: at(0.99), max: at(1), mean: round(mean, decimals) };
}

export function umpVsAbs(all: readonly Judged[]) {
  let agree = 0;
  let after = 0;
  let closeAgree = 0;
  let closeTotal = 0;
  let nearAgree = 0;
  let nearTotal = 0;
  let strikesCalledBalls = 0;
  let ballsCalledStrikes = 0;

  for (const j of all) {
    const ok = j.p.umpCall === j.truth;
    const m = Math.abs(j.marginIn);

    if (ok) agree++;
    else if (j.truth === 'S') strikesCalledBalls++;
    else ballsCalledStrikes++;
    if (j.p.finalCall === j.truth) after++;
    if (m <= CLOSE_IN) {
      closeTotal++;
      if (ok) closeAgree++;
    }
    if (m <= NEAR_IN) {
      nearTotal++;
      if (ok) nearAgree++;
    }
  }

  return {
    overall: tally(agree, all.length),
    close: { withinIn: CLOSE_IN, ...tally(closeAgree, closeTotal) },
    near: { withinIn: NEAR_IN, ...tally(nearAgree, nearTotal) },
    afterChallenges: tally(after, all.length),
    missed: { strikesCalledBalls, ballsCalledStrikes },
  };
}

export function challengeStats(all: readonly Judged[]) {
  const challenged = all.filter((j) => j.p.challenge);
  const roles: Role[] = ['catcher', 'pitcher', 'batter'];
  const byRole = Object.fromEntries(
    roles.map((role) => {
      const mine = challenged.filter((j) => j.p.challenge?.role === role);

      return [role, { challenges: mine.length, overturned: mine.filter((j) => j.p.challenge?.overturned).length }];
    }),
  );

  return {
    total: challenged.length,
    overturned: challenged.filter((j) => j.p.challenge?.overturned).length,
    byRole,
    absAgreesWithFinalCall: tally(challenged.filter((j) => j.truth === j.p.finalCall).length, challenged.length),
  };
}

export function byGameType<T>(all: readonly Judged[], games: readonly Game[], f: (some: Judged[]) => T) {
  const type = new Map(games.map((g) => [g.gamePk, g.gameType]));
  const groups = new Map<GameType, Judged[]>(GAME_TYPES.map((t) => [t, []]));

  for (const j of all) {
    const t = type.get(j.p.gamePk);

    if (t) groups.get(t)?.push(j);
  }

  return Object.fromEntries([...groups].map(([t, some]) => [t, f(some)]));
}

interface VariantDef {
  name: string;
  strike: (j: Judged) => boolean | null;
}

// How the agreement moves when one modelling choice changes. A row returns null for a pitch it cannot judge.
export function variants(all: readonly Judged[], people: Map<number, Person>) {
  const heightFt = (id: number): number | null => {
    const h = people.get(id)?.heightIn;

    return h ? h / 12 : null;
  };
  const defs: VariantDef[] = [
    { name: 'mid-plate, r = 1.45 in, exact geometry (used)', strike: (j) => j.truth === 'S' },
    { name: 'mid-plate, r = 1.45 in, box rule', strike: (j) => boxStrike(j.mid.x, j.mid.z, j.p.zoneTop, j.p.zoneBottom) },
    {
      name: 'front of plate, r = 1.45 in, exact geometry',
      strike: (j) => {
        const f = crossing(j.p.traj, PLATE_FRONT_Y);

        return absJudge(f.x, f.z, j.p.zoneTop, j.p.zoneBottom).strike;
      },
    },
    {
      name: 'feed pX/pZ, r = 1.45 in, exact geometry',
      strike: (j) => (j.p.pX === null || j.p.pZ === null ? null : absJudge(j.p.pX, j.p.pZ, j.p.zoneTop, j.p.zoneBottom).strike),
    },
    { name: 'mid-plate, ball centre only (r = 0)', strike: (j) => absJudge(j.mid.x, j.mid.z, j.p.zoneTop, j.p.zoneBottom, 0).strike },
    {
      name: 'mid-plate, zone from roster height x 53.5% / 27%',
      strike: (j) => {
        const h = heightFt(j.p.batterId);

        return h === null ? null : absJudge(j.mid.x, j.mid.z, 0.535 * h, 0.27 * h).strike;
      },
    },
  ];

  return defs.map((v) => {
    let agree = 0;
    let total = 0;
    let match = 0;
    let challenges = 0;

    for (const j of all) {
      const s = v.strike(j);

      if (s === null) continue;

      const call = s ? 'S' : 'B';

      total++;
      if (call === j.p.umpCall) agree++;
      if (j.p.challenge) {
        challenges++;
        if (call === j.p.finalCall) match++;
      }
    }

    return { variant: v.name, umpAgreement: tally(agree, total), challengeMatches: tally(match, challenges) };
  });
}

export function challengeMismatches(all: readonly Judged[], people: Map<number, Person>, games: readonly Game[]) {
  const date = new Map(games.map((g) => [g.gamePk, g.date]));

  return all
    .filter((j) => j.p.challenge && j.truth !== j.p.finalCall)
    .sort((a, b) => Math.abs(a.marginIn) - Math.abs(b.marginIn) || a.seq - b.seq)
    .map((j) => {
      const h = people.get(j.p.batterId)?.heightIn ?? null;
      const f = crossing(j.p.traj, PLATE_FRONT_Y);
      const c = j.p.challenge;

      return {
        id: j.p.id,
        date: date.get(j.p.gamePk) ?? null,
        role: c?.role ?? null,
        overturned: c?.overturned ?? null,
        source: c?.source ?? null,
        ump: j.p.umpCall,
        final: j.p.finalCall,
        abs: j.truth,
        marginIn: round(j.marginIn, 3),
        frontMarginIn: round(absJudge(f.x, f.z, j.p.zoneTop, j.p.zoneBottom).marginIn, 3),
        rosterZoneMarginIn: h ? round(absJudge(j.mid.x, j.mid.z, (0.535 * h) / 12, (0.27 * h) / 12).marginIn, 3) : null,
        zone: [round(j.p.zoneTop, 4), round(j.p.zoneBottom, 4)],
        heightIn: h,
      };
    });
}

// The 2026 zone is set from each batter's measured height, so it should not change from pitch to pitch.
export function zoneChecks(all: readonly Judged[], people: Map<number, Person>) {
  const zones = new Map<number, Map<string, number>>();

  for (const j of all) {
    const key = `${round(j.p.zoneTop, 4)}|${round(j.p.zoneBottom, 4)}`;
    const mine = zones.get(j.p.batterId) ?? new Map<string, number>();

    mine.set(key, (mine.get(key) ?? 0) + 1);
    zones.set(j.p.batterId, mine);
  }

  const topRatio: number[] = [];
  const bottomRatio: number[] = [];
  const varying: Array<{ batter: number; zones: number; pitches: number; topRange: number[]; bottomRange: number[] }> = [];

  for (const [batter, mine] of zones) {
    const ranked = [...mine].sort((a, b) => b[1] - a[1]);
    const [top, bottom] = (ranked[0]?.[0] ?? '0|0').split('|').map(Number);
    const h = people.get(batter)?.heightIn;

    if (h && top && bottom) {
      topRatio.push(top / (h / 12));
      bottomRatio.push(bottom / (h / 12));
    }
    if (mine.size > 1) {
      const tops = ranked.map(([k]) => Number(k.split('|')[0]));
      const bottoms = ranked.map(([k]) => Number(k.split('|')[1]));

      varying.push({
        batter,
        zones: mine.size,
        pitches: ranked.reduce((a, [, n]) => a + n, 0),
        topRange: [Math.min(...tops), Math.max(...tops)],
        bottomRange: [Math.min(...bottoms), Math.max(...bottoms)],
      });
    }
  }
  varying.sort((a, b) => b.zones - a.zones || a.batter - b.batter);

  return {
    batters: zones.size,
    battersWithMoreThanOneZone: varying.length,
    mostVaried: varying.slice(0, 20),
    topOverRosterHeight: spread(topRatio),
    bottomOverRosterHeight: spread(bottomRatio),
  };
}

// The feed's pX/pZ sit on the front of the plate, not the judging plane; the season should agree with the Series.
export function pxpzResiduals(all: readonly Judged[]) {
  const front: number[] = [];
  const mid: number[] = [];

  for (const j of all) {
    if (j.p.pX === null || j.p.pZ === null) continue;

    const f = crossing(j.p.traj, PLATE_FRONT_Y);

    front.push(12 * Math.hypot(f.x - j.p.pX, f.z - j.p.pZ));
    mid.push(12 * Math.hypot(j.mid.x - j.p.pX, j.mid.z - j.p.pZ));
  }

  return { vsFrontOfPlateIn: spread(front, 4), vsMidPlateIn: spread(mid, 4) };
}

// A right-hander releases from the third-base side (x < 0) and a left-hander from the first-base side, so a release
// well across the middle points at a pitcher attributed with the wrong hand.
export function releaseSides(all: readonly Judged[]) {
  const xs: Record<'L' | 'R', number[]> = { L: [], R: [] };
  const crossed: Record<string, number> = {};

  for (const j of all) {
    if (j.p.extension === null) continue;

    const x = posAt(j.p.traj, releaseT(j.p.traj, j.p.extension)).x;

    xs[j.p.throws].push(x);
    if ((j.p.throws === 'R' && x > 0.5) || (j.p.throws === 'L' && x < -0.5)) {
      crossed[j.p.attribution] = (crossed[j.p.attribution] ?? 0) + 1;
    }
  }

  return { releaseXFt: { R: spread(xs.R, 3), L: spread(xs.L, 3) }, acrossTheMiddleByAttribution: crossed };
}
