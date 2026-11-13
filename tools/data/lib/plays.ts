import { MID_Y, PLATE_FRONT_Y } from './constants.ts';
import type { Play, PlayByPlay, PlayEvent, Ref, Review, Runner } from './mlb.ts';
import type { Person } from './people.ts';
import { TRAJ_KEYS, tAtY, type Traj } from './physics.ts';
import type { Game } from './schedule.ts';

export type Call = 'S' | 'B';
export type Side = 'L' | 'R';
export type Role = 'batter' | 'pitcher' | 'catcher';
export type Attribution = 'matchup' | 'replaced' | 'uncertain';

type Base = '1B' | '2B' | '3B';

export interface Challenge {
  byId: number;
  byName: string;
  teamId: number;
  role: Role;
  overturned: boolean;
  source: 'pitch' | 'play';
}

export interface CalledPitch {
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
  batterId: number;
  batterName: string;
  bats: Side;
  pitcherId: number;
  pitcherName: string;
  throws: Side;
  attribution: Attribution;
  pitchType: string | null;
  pitchTypeName: string | null;
  mph: number | null;
  extension: number | null;
  traj: Traj;
  zoneTop: number;
  zoneBottom: number;
  pX: number | null;
  pZ: number | null;
  umpCall: Call;
  finalCall: Call;
  challenge: Challenge | null;
}

export interface Checks {
  plays: number;
  pitchEvents: number;
  calledCodes: number;
  ballInDirt: number;
  automatic: number;
  noTracking: number;
  runnersChecked: number;
  countMismatches: string[];
  outsMismatches: string[];
  scoreMismatches: string[];
  runnersMismatches: string[];
  challengesOnExcluded: string[];
  orphanReviews: string[];
  roleAnomalies: string[];
  midPaSubstitutions: string[];
}

export interface GameExtract {
  pitches: CalledPitch[];
  checks: Checks;
}

interface Who {
  id: number;
  name: string;
}

interface Attr {
  batter: Who;
  bats: Side;
  pitcher: Who;
  throws: Side;
  attribution: Attribution;
}

interface Assigned {
  review: Review;
  source: 'pitch' | 'play';
}

interface Sides {
  battingId: number;
  fieldingId: number;
  batterId: number;
  pitcherId: number;
}

interface Tracking {
  traj: Traj;
  top: number;
  bottom: number;
}

const COUNTERS = ['plays', 'pitchEvents', 'calledCodes', 'ballInDirt', 'automatic', 'noTracking', 'runnersChecked'] as const;
const LISTS = [
  'countMismatches',
  'outsMismatches',
  'scoreMismatches',
  'runnersMismatches',
  'challengesOnExcluded',
  'orphanReviews',
  'roleAnomalies',
  'midPaSubstitutions',
] as const;
const BASE_BIT: Record<Base, number> = { '1B': 1, '2B': 2, '3B': 4 };
const UNKNOWN: Who = { id: 0, name: 'Unknown' };
const UNKNOWN_ATTR: Attr = { batter: UNKNOWN, bats: 'R', pitcher: UNKNOWN, throws: 'R', attribution: 'uncertain' };

const isBase = (b: string | null | undefined): b is Base => b === '1B' || b === '2B' || b === '3B';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown): number | null => (isNum(v) ? v : null);
const toSide = (code: string | null | undefined): Side | null => (code === 'L' || code === 'R' ? code : null);
const opposite = (s: Side): Side => (s === 'L' ? 'R' : 'L');
const flip = (c: Call): Call => (c === 'S' ? 'B' : 'S');
const nameOf = (ref: Ref, people: Map<number, Person>): string => people.get(ref.id)?.name ?? ref.fullName ?? `#${ref.id}`;
const isAutomatic = (e: PlayEvent): boolean =>
  /automatic/i.test(`${e.details?.description ?? ''} ${e.details?.call?.description ?? ''}`);
const isPitchingChange = (e: PlayEvent): boolean => e.details?.eventType === 'pitching_substitution';
const isPinchHitter = (e: PlayEvent): boolean =>
  e.details?.eventType === 'offensive_substitution' &&
  (e.position?.abbreviation === 'PH' || /pinch[-\s]?hitter/i.test(e.details?.description ?? ''));

export function emptyChecks(): Checks {
  return {
    plays: 0,
    pitchEvents: 0,
    calledCodes: 0,
    ballInDirt: 0,
    automatic: 0,
    noTracking: 0,
    runnersChecked: 0,
    countMismatches: [],
    outsMismatches: [],
    scoreMismatches: [],
    runnersMismatches: [],
    challengesOnExcluded: [],
    orphanReviews: [],
    roleAnomalies: [],
    midPaSubstitutions: [],
  };
}

export function addChecks(into: Checks, more: Checks): void {
  for (const k of COUNTERS) {
    into[k] += more[k];
  }
  for (const k of LISTS) {
    for (const s of more[k]) into[k].push(s);
  }
}

// reviewType MJ is a team challenge (M) of the pitch result (J); every other review is ordinary replay.
export function mjReviews(r: Review | undefined): Review[] {
  return r ? [r, ...(r.additionalReviews ?? [])].filter((x) => x.reviewType === 'MJ') : [];
}

// Everyone whose roster entry the build needs: batters for heights, challengers for positions, and players replaced in
// the middle of a plate appearance for their handedness.
export function peopleIdsIn(pbp: PlayByPlay): Set<number> {
  const ids = new Set<number>();

  for (const play of pbp.allPlays ?? []) {
    if (play.matchup?.batter) ids.add(play.matchup.batter.id);
    for (const r of mjReviews(play.reviewDetails)) {
      if (r.player) ids.add(r.player.id);
    }
    for (const e of play.playEvents ?? []) {
      for (const r of mjReviews(e.reviewDetails)) {
        if (r.player) ids.add(r.player.id);
      }
      if (e.replacedPlayer && (isPitchingChange(e) || isPinchHitter(e))) ids.add(e.replacedPlayer.id);
    }
  }

  return ids;
}

function trackingOf(e: PlayEvent): Tracking | null {
  const pd = e.pitchData;
  const c = pd?.coordinates;
  const top = pd?.strikeZoneTop;
  const bottom = pd?.strikeZoneBottom;

  if (!c || !isNum(top) || !isNum(bottom) || bottom <= 0 || top <= bottom) return null;

  const traj = {} as Traj;

  for (const k of TRAJ_KEYS) {
    const v = c[k];

    if (!isNum(v)) return null;
    traj[k] = v;
  }

  // A fit that never reaches the plate cannot be judged.
  const reaches = traj.vY0 < 0 && Number.isFinite(tAtY(traj, PLATE_FRONT_Y)) && Number.isFinite(tAtY(traj, MID_Y));

  return reaches ? { traj, top, bottom } : null;
}

// A runner we have not seen leave a base (a pinch runner) replaces whoever is there and has not moved yet this play.
function stepRunner(bases: Map<number, Base>, touched: Set<number>, r: Runner): void {
  const id = r.details?.runner?.id;
  const start = r.movement?.start ?? null;
  const end = r.movement?.end ?? null;

  if (id === undefined) return;
  if (isBase(start) && !bases.has(id)) {
    for (const [other, base] of bases) {
      if (base === start && !touched.has(other)) bases.delete(other);
    }
  }
  if (r.movement?.isOut || !isBase(end)) bases.delete(id);
  else bases.set(id, end);
  touched.add(id);
}

function bitsOf(bases: Map<number, Base>): number {
  let bits = 0;

  for (const b of bases.values()) bits |= BASE_BIT[b];

  return bits;
}

function postBases(play: Play): Map<number, Base> {
  const m = play.matchup;
  const bases = new Map<number, Base>();

  if (m?.postOnFirst) bases.set(m.postOnFirst.id, '1B');
  if (m?.postOnSecond) bases.set(m.postOnSecond.id, '2B');
  if (m?.postOnThird) bases.set(m.postOnThird.id, '3B');

  return bases;
}

function sameBases(a: Map<number, Base>, b: Map<number, Base>): boolean {
  return a.size === b.size && [...a].every(([id, base]) => b.get(id) === base);
}

function describeBases(bases: Map<number, Base>): string {
  return [...bases.values()].sort().join(',') || 'empty';
}

// The matchup names whoever finished the plate appearance. Walking back from the last pitch, a pitching change or a
// pinch hitter between pitches hands the earlier pitches to the player who was replaced.
function attribute(
  play: Play,
  events: PlayEvent[],
  people: Map<number, Person>,
  checks: Checks,
  paId: string,
): Map<number, Attr> {
  const m = play.matchup;
  const out = new Map<number, Attr>();
  const first = events.findIndex((e) => e.isPitch);
  const last = events.findLastIndex((e) => e.isPitch);
  const matchupBats = toSide(m?.batSide?.code);
  let batter: Who | null = m?.batter ? { id: m.batter.id, name: nameOf(m.batter, people) } : null;
  let pitcher: Who | null = m?.pitcher ? { id: m.pitcher.id, name: nameOf(m.pitcher, people) } : null;
  let throws = toSide(m?.pitchHand?.code);
  let batterIsMatchup = true;
  let pitcherIsMatchup = true;
  let sure = true;

  const batsNow = (): Side | null => {
    if (batterIsMatchup && pitcherIsMatchup) return matchupBats;

    const listed = batter ? people.get(batter.id)?.bats : undefined;

    if (listed === 'S') return throws ? opposite(throws) : null;

    return toSide(listed) ?? (batterIsMatchup ? matchupBats : null);
  };

  for (let k = events.length - 1; k >= 0; k--) {
    const e = events[k];

    if (!e) continue;
    if (e.isPitch) {
      const bats = batsNow();
      const certain = sure && batter !== null && pitcher !== null && bats !== null && throws !== null;
      const kind: Attribution = batterIsMatchup && pitcherIsMatchup ? 'matchup' : 'replaced';

      out.set(k, {
        batter: batter ?? UNKNOWN,
        bats: bats ?? 'R',
        pitcher: pitcher ?? UNKNOWN,
        throws: throws ?? 'R',
        attribution: certain ? kind : 'uncertain',
      });
      continue;
    }
    if (k <= first || k >= last) continue;
    if (isPitchingChange(e)) {
      checks.midPaSubstitutions.push(`${paId} pitcher`);
      if (e.replacedPlayer) {
        pitcher = { id: e.replacedPlayer.id, name: nameOf(e.replacedPlayer, people) };
        throws = toSide(people.get(e.replacedPlayer.id)?.throws);
        pitcherIsMatchup = false;
      } else {
        sure = false;
      }
    } else if (isPinchHitter(e)) {
      checks.midPaSubstitutions.push(`${paId} batter`);
      if (e.replacedPlayer) {
        batter = { id: e.replacedPlayer.id, name: nameOf(e.replacedPlayer, people) };
        batterIsMatchup = false;
      } else {
        sure = false;
      }
    }
  }

  return out;
}

// A challenge is usually on the pitch event. A challenged pitch that ended the plate appearance is recorded only on the
// play, so it belongs to the last pitch.
function assignReviews(play: Play, events: PlayEvent[], checks: Checks, paId: string): Map<number, Assigned> {
  const out = new Map<number, Assigned>();
  const last = events.findLastIndex((e) => e.isPitch);

  for (const [pos, e] of events.entries()) {
    const [r] = mjReviews(e.reviewDetails);

    if (!r) continue;
    if (e.isPitch) out.set(pos, { review: r, source: 'pitch' });
    else checks.orphanReviews.push(`${paId}: challenge on a ${e.details?.eventType ?? e.type ?? 'non-pitch'} event`);
  }
  for (const r of mjReviews(play.reviewDetails)) {
    if (last >= 0 && !out.has(last)) out.set(last, { review: r, source: 'play' });
    else checks.orphanReviews.push(`${paId}: play-level challenge with no unclaimed last pitch`);
  }

  return out;
}

function roleOf(
  byId: number | undefined,
  teamId: number,
  s: Sides,
  people: Map<number, Person>,
  anomalies: string[],
  pid: string,
): Role {
  if (teamId === s.battingId) {
    if (byId !== s.batterId) anomalies.push(`${pid}: batting-team challenge by ${byId ?? 'unknown'}, not the batter`);

    return 'batter';
  }
  if (teamId === s.fieldingId) {
    if (byId === s.pitcherId) return 'pitcher';
    if (byId === undefined || people.get(byId)?.position !== 'C') {
      anomalies.push(`${pid}: fielding-team challenge by ${byId ?? 'unknown'}, not the pitcher or a listed catcher`);
    }

    return 'catcher';
  }
  anomalies.push(`${pid}: challenge team ${teamId} is neither side`);

  return byId === s.batterId ? 'batter' : byId === s.pitcherId ? 'pitcher' : 'catcher';
}

export function extractGame(pbp: PlayByPlay, game: Game, people: Map<number, Person>): GameExtract {
  const pitches: CalledPitch[] = [];
  const checks = emptyChecks();
  let prev: Play | undefined;
  let bases = new Map<number, Base>();
  let score = { away: 0, home: 0 };

  for (const play of pbp.allPlays ?? []) {
    const about = play.about ?? {};
    const top = about.isTopInning ?? about.halfInning === 'top';
    const inning = about.inning ?? 0;
    const atBat = play.atBatIndex ?? about.atBatIndex ?? checks.plays;
    const paId = `${game.gamePk}-${atBat}`;
    const prevTop = prev?.about?.isTopInning ?? prev?.about?.halfInning === 'top';
    const newHalf = prev === undefined || prev.about?.inning !== inning || prevTop !== top;
    const outsStart = newHalf ? 0 : (prev?.count?.outs ?? 0);
    const battingId = top ? game.awayId : game.homeId;
    const fieldingId = top ? game.homeId : game.awayId;
    const events = play.playEvents ?? [];
    const batterId = play.matchup?.batter?.id;
    const placed = (r: Runner): boolean =>
      (r.movement?.start ?? null) === null && isBase(r.movement?.end) && r.details?.runner?.id !== batterId;
    // The extra-innings runner is placed from nowhere before the first pitch, whatever playIndex the feed gives it.
    const when = (r: Runner): number => (placed(r) ? -1 : (r.details?.playIndex ?? Number.POSITIVE_INFINITY));
    const runners = [...(play.runners ?? [])].sort((a, b) => when(a) - when(b));
    const attrs = attribute(play, events, people, checks, paId);
    const reviews = assignReviews(play, events, checks, paId);
    const startScore = { ...score };
    const endAway = play.result?.awayScore ?? Number.POSITIVE_INFINITY;
    const endHome = play.result?.homeScore ?? Number.POSITIVE_INFINITY;
    let count = { balls: 0, strikes: 0 };
    let runScore = { ...score };
    let pitchCount = 0;

    checks.plays++;
    if (newHalf) bases = new Map();

    for (const [pos, ev] of events.entries()) {
      const index = ev.index ?? pos;
      const d = ev.details;

      if (ev.isPitch) {
        pitchCount++;
        checks.pitchEvents++;

        const code = d?.call?.code ?? d?.code ?? '';
        const pid = `${paId}-${ev.pitchNumber ?? pitchCount}`;
        const review = reviews.get(pos);
        const called = code === 'B' || code === 'C';
        const auto = called && isAutomatic(ev);
        const tracking = called && !auto ? trackingOf(ev) : null;

        if (called) checks.calledCodes++;
        if (code === '*B') checks.ballInDirt++;
        if (auto) checks.automatic++;
        else if (called && !tracking) checks.noTracking++;

        if (tracking) {
          const attr = attrs.get(pos) ?? UNKNOWN_ATTR;
          const before = new Map(bases);
          const touched = new Set<number>();
          const finalCall: Call = code === 'C' ? 'S' : 'B';
          const overturned = review?.review.isOverturned === true;
          const umpCall = overturned ? flip(finalCall) : finalCall;
          const feed = ev.count;
          const feedOuts = feed?.outs;
          let outs = outsStart;
          let challenge: Challenge | null = null;

          for (const r of runners) {
            if (when(r) >= index) break;
            if (r.movement?.isOut) outs++;
            stepRunner(before, touched, r);
          }

          const expectBalls = count.balls + (code === 'B' ? 1 : 0);
          const expectStrikes = count.strikes + (code === 'C' ? 1 : 0);

          if (feed && (feed.balls !== expectBalls || feed.strikes !== expectStrikes)) {
            checks.countMismatches.push(`${pid}: ${count.balls}-${count.strikes} + ${code} -> ${feed.balls}-${feed.strikes}`);
          }
          if (isNum(feedOuts) && feedOuts !== outs) checks.outsMismatches.push(`${pid}: rebuilt ${outs}, feed ${feedOuts}`);
          if (
            runScore.away < startScore.away ||
            runScore.home < startScore.home ||
            runScore.away > endAway ||
            runScore.home > endHome
          ) {
            checks.scoreMismatches.push(`${pid}: ${runScore.away}-${runScore.home}`);
          }
          if (review) {
            const by = review.review.player;
            const teamId = review.review.challengeTeamId ?? (by?.id === attr.batter.id ? battingId : fieldingId);
            const sides = { battingId, fieldingId, batterId: attr.batter.id, pitcherId: attr.pitcher.id };
            const role = roleOf(by?.id, teamId, sides, people, checks.roleAnomalies, pid);
            const challengeable: Call = teamId === battingId ? 'S' : 'B';

            if (umpCall !== challengeable) {
              checks.roleAnomalies.push(`${pid}: ${role} challenged a called ${umpCall === 'S' ? 'strike' : 'ball'}`);
            }
            challenge = {
              byId: by?.id ?? 0,
              byName: by ? nameOf(by, people) : 'Unknown',
              teamId,
              role,
              overturned,
              source: review.source,
            };
          }

          pitches.push({
            id: pid,
            gamePk: game.gamePk,
            atBat,
            pitch: ev.pitchNumber ?? pitchCount,
            inning,
            top,
            outs,
            balls: count.balls,
            strikes: count.strikes,
            awayScore: runScore.away,
            homeScore: runScore.home,
            bases: bitsOf(before),
            batterId: attr.batter.id,
            batterName: attr.batter.name,
            bats: attr.bats,
            pitcherId: attr.pitcher.id,
            pitcherName: attr.pitcher.name,
            throws: attr.throws,
            attribution: attr.attribution,
            pitchType: d?.type?.code ?? null,
            pitchTypeName: d?.type?.description ?? null,
            mph: num(ev.pitchData?.startSpeed),
            extension: num(ev.pitchData?.extension),
            traj: tracking.traj,
            zoneTop: tracking.top,
            zoneBottom: tracking.bottom,
            pX: num(ev.pitchData?.coordinates?.pX),
            pZ: num(ev.pitchData?.coordinates?.pZ),
            umpCall,
            finalCall,
            challenge,
          });
        } else if (review) {
          const why = auto ? ', automatic' : called ? ', no tracking' : '';

          checks.challengesOnExcluded.push(`${pid} (${code || 'no call'}${why})`);
        }
      }

      if (ev.count) count = { balls: ev.count.balls ?? count.balls, strikes: ev.count.strikes ?? count.strikes };
      if (d && isNum(d.awayScore) && isNum(d.homeScore)) runScore = { away: d.awayScore, home: d.homeScore };
    }

    const touched = new Set<number>();

    for (const r of runners) stepRunner(bases, touched, r);
    if ((play.count?.outs ?? 0) < 3) {
      const feed = postBases(play);

      checks.runnersChecked++;
      if (!sameBases(bases, feed)) {
        checks.runnersMismatches.push(`${paId}: rebuilt ${describeBases(bases)}, feed ${describeBases(feed)}`);
      }
      bases = feed;
    }
    score = { away: play.result?.awayScore ?? runScore.away, home: play.result?.homeScore ?? runScore.home };
    prev = play;
  }

  return { pitches, checks };
}
