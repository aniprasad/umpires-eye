// The mockup's ?selftest=1 guarantees, as pure checks. Vitest runs each one; the page prints them at ?selftest=1.
import { absJudge } from '../core/abs.ts';
import { varietyProblems } from '../core/daily.ts';
import { tenProblems } from '../core/deal.ts';
import { posAt } from '../core/kinematics.ts';
import { mulberry32 } from '../core/rng.ts';
import { BALL_R, CLOSE_IN, DEAL_BOX, MID_Y, PLATE_FRONT_Y, PLATE_HALF, RUBBER_Y } from '../core/rules.ts';
import type { Family } from '../core/schema.ts';
import { batterDof, batterRig, headSpan } from '../math/batter';
import { catcherRig, frameOf, frameShift, mittBox, mittProgress, mittState } from '../math/catcher';
import { CATCH_Y, CROSS_PAD, FRAME, MOUND_H, STANCE, STANCE_MAX } from '../math/constants';
import { listJoin, pickPoolTen, playable, seriesGames } from '../math/deal';
import { DOF, dofBlur } from '../math/dof';
import { makeCam, sphereOutline, vfovDeg, withUnion, type LensCam } from '../math/geometry';
import { ballT, prep, type PreparedPitch } from '../math/kinematics';
import { createLens, type Lens } from '../math/lens';
import { maskGeom, maskSamples } from '../math/mask';
import { pitcherPose } from '../math/pitcher';
import { eyeOf, stanceCorners, stanceOf } from '../math/stance';
import type { Call, Pitch, Side } from '../math/types';
import { lastName } from '../math/words';
import type { WorldSeries } from '../data/ws2026';

export interface SelfTestCtx {
  pool: readonly Pitch[];
  today: readonly Pitch[];
  /** What Another ten deals from. */
  deck: readonly Pitch[];
  /** The prepared Today's Ten the app plays (fresh preps in Node). */
  todaySet: readonly PreparedPitch[];
  lens: Lens;
}

export interface CheckResult {
  lines: string[];
  failures: string[];
  stats: Record<string, number>;
}

export interface Check {
  id: string;
  name: string;
  run(ctx: SelfTestCtx): CheckResult;
}

export const SIZES: readonly (readonly [number, number])[] = [[1440, 900], [1920, 1080], [1280, 800], [1024, 768], [390, 844]];
const SIDES: readonly Side[] = ['R', 'L'];

export function selfTestContext(ws: WorldSeries, todaySet?: readonly PreparedPitch[]): SelfTestCtx {
  return {
    pool: ws.pitches,
    today: ws.today,
    deck: ws.deck,
    todaySet: todaySet || ws.today.map(prep),
    lens: createLens(ws.lensPoints),
  };
}

/**
 * The season's report covers the date's Ten. The season has no pool in memory, and its pool-wide guarantees (the ABS
 * truth, the challenges, the flight limit and dealing) are data:validate's, over every shard.
 */
export function seasonSelfTestContext(todaySet: readonly PreparedPitch[], lens: Lens): SelfTestCtx {
  return { pool: todaySet, today: todaySet, deck: [], todaySet, lens };
}

const f = (v: number, n = 4): string => (v >= 0 ? ' ' : '') + v.toFixed(n);

interface Checked {
  P: PreparedPitch;
  dmx: number;
  dmz: number;
  dm: number;
  truth: Call;
  ok: boolean;
}

/** Recompute the mid-plate crossing, release, timing and ABS truth from the trajectory, against the data. */
function checkPitch(p: Pitch): Checked {
  const P = prep(p);
  const k = P.k;
  const dmx = k.mid.x - p.mid.x;
  const dmz = k.mid.z - p.mid.z;
  const yAtMid = posAt(p.traj, k.tMid).y - MID_Y;
  const dRel = Math.hypot(k.rel.x - p.release.x, k.rel.y - p.release.y, k.rel.z - p.release.z);
  const truth: Call = k.judge.strike ? 'strike' : 'ball';
  const dm = k.judge.marginIn - p.edgeMarginIn;
  // the renderer's clock: at s = flight the ball must sit on the front plane, at s = toMid on the ABS plane
  const yFront = posAt(p.traj, ballT(P, k.flight)).y - PLATE_FRONT_Y;
  const yMidR = posAt(p.traj, ballT(P, k.toMid)).y - MID_Y;
  const ok = Math.abs(dmx) <= 0.01 && Math.abs(dmz) <= 0.01 && Math.abs(yAtMid) < 1e-9 && truth === p.absTruth
    && Math.abs(dm) <= 0.011 && Math.abs(yFront) < 1e-9 && Math.abs(yMidR) < 1e-9 && dRel <= 0.01
    && Math.abs(k.flight - p.flightTime) <= 0.0011;

  return { P, dmx, dmz, dm, truth, ok };
}

function describeFraming(lens: Lens, P: PreparedPitch): string {
  const q = frameOf(P);

  if (!q) return 'not framed';
  const d = Math.abs(q.dz) > Math.abs(q.dx) ? (q.dz > 0 ? 'up' : 'down') : 'across';
  const cam = lens.camFor(1440, 900, P);
  const c = P.k.catchP;
  const a = cam.p(c);
  const b = cam.p({ x: c.x + q.dx * q.ft, y: c.y, z: c.z + q.dz * q.ft });
  const vis = a.y < 900 ? `${Math.hypot(b.x - a.x, b.y - a.y).toFixed(0)} px at 1440x900` : b.y < 900 ? 'framed up into the 1440x900 frame' : 'below the 1440x900 frame';

  return `framed ${d} ${(q.ft * 12).toFixed(1)} in over ${(q.dur * 1000).toFixed(0)} ms (${vis})`;
}

function todayPitches(ctx: SelfTestCtx): CheckResult {
  const lines = ["[TODAY'S TEN] mid-plate crossing recomputed from traj vs data.mid; ABS truth recomputed (r = 1.45 in, exact disc)"];
  const failures: string[] = [];
  let bad = 0;

  ctx.today.forEach((p, i) => {
    const r = checkPitch(p);

    if (!r.ok) {
      bad++;
      failures.push(`today ${p.id}`);
    }
    lines.push(`${String(i + 1).padStart(2)} ${p.id.padEnd(12)} ${p.game.seriesGame ? `G${p.game.seriesGame} ` : ''}${lastName(p.batter.name).padEnd(9)} ${p.pitchType.code} | edge ${f(r.P.k.judge.marginIn, 2)} in (data ${f(p.edgeMarginIn, 2)}) | truth ${r.truth.padEnd(6)} data ${p.absTruth.padEnd(6)} ump ${p.umpCall.padEnd(6)}${p.challenge ? ' (ABS challenge)' : ''} | dMid x${f(r.dmx)} z${f(r.dmz)} ft | release->plate ${r.P.k.flight.toFixed(3)} s (to mid ${r.P.k.toMid.toFixed(3)}, to mitt ${r.P.k.toCatch.toFixed(3)}) | ${describeFraming(ctx.lens, r.P)} | ${r.ok ? 'PASS' : 'FAIL'}`);
  });

  return { lines, failures, stats: { pitches: ctx.today.length, bad } };
}

/** The deal itself: an easy calibrator first, about eight close calls, at least one ABS challenge, both sides of the
 * plate and all three pitch families. The real ump's tally is whatever the data says on these ten. */
function todayMakeUp(ctx: SelfTestCtx): CheckResult {
  const T = ctx.today;
  const failures: string[] = [];
  let umpRight = 0;
  let umpData = 0;
  let umpAfter = 0;
  let flightMin = 9;
  let flightMax = 0;

  for (const p of T) {
    const r = checkPitch(p);

    if (r.truth === p.umpCall) umpRight++;
    if (p.umpCorrect) umpData++;
    if (p.finalCall === r.truth) umpAfter++;
    flightMin = Math.min(flightMin, r.P.k.flight);
    flightMax = Math.max(flightMax, r.P.k.flight);
  }
  const tm = T.map((p) => Math.abs(p.edgeMarginIn));
  const nClose = tm.filter((m) => m <= CLOSE_IN).length;
  const fam = new Set(T.map((p) => p.pitchType.family));
  const sides = new Set(T.map((p) => p.batter.side));
  const tBalls = T.filter((p) => Math.abs(p.edgeMarginIn) <= CLOSE_IN && p.absTruth === 'ball').length;
  const challenged = T.filter((p) => p.challenge).length;
  const games = seriesGames(T);
  const lines = [
    `today: calibrator first (${f(T[0].edgeMarginIn, 2)} in) | ${nClose}/10 within ${CLOSE_IN} in (${tm.filter((m) => m <= CLOSE_IN).sort((a, b) => a - b).map((m) => m.toFixed(2)).join(', ')}): ${tBalls} balls, ${nClose - tBalls} strikes | ABS-challenged ${challenged} | games ${listJoin(games)} | families ${[...fam].join('/')} | bats ${[...sides].join('/')}`,
    `today: real ump right ${umpRight}/10 on the field (data umpCorrect says ${umpData}/10), ${umpAfter}/10 after ABS challenges; flight ${flightMin.toFixed(3)}-${flightMax.toFixed(3)} s`,
  ];

  if (umpRight !== umpData) failures.push('today ump count');
  if (tm[0] < 6 || nClose < 7 || nClose > 9 || !challenged || fam.size < 3 || sides.size < 2 || T.some((p) => !playable(p))) failures.push('today deal');

  return { lines, failures, stats: { umpRight, umpData, umpAfter, close: nClose, closeBalls: tBalls, challenged, calibratorIn: tm[0], families: fam.size, sides: sides.size } };
}

/**
 * The season's Today's Ten: the dealer's rules and the schedule's variety rules (docs/M2-DESIGN.md §2.3, §2.4), as the
 * build applied them, in the order the file gives. The real ump's tally is whatever the data says.
 */
function todayRules(ctx: SelfTestCtx): CheckResult {
  const T = ctx.today;
  const cards = T.map((p) => ({
    id: p.id,
    seq: p.order,
    absMarginIn: Math.abs(p.edgeMarginIn),
    challenged: !!p.challenge,
    gamePk: p.gamePk,
    bats: p.batter.side,
    family: p.pitchType.family as Family,
    balls: p.countBefore.balls,
    strikes: p.countBefore.strikes,
  }));
  const problems = [...tenProblems(cards), ...varietyProblems(cards)];
  const umpRight = T.filter((p) => checkPitch(p).truth === p.umpCall).length;
  const umpData = T.filter((p) => p.umpCorrect).length;
  const failures = problems.map((p) => `today rules: ${p}`);

  if (umpRight !== umpData) failures.push('today ump count');

  return {
    lines: [`today: the dealer's and the schedule's rules: ${problems.length ? problems.join('; ') : 'all kept'} | real ump right ${umpRight}/${T.length} on the field (data umpCorrect says ${umpData}/${T.length})`],
    failures,
    stats: { problems: problems.length, umpRight, umpData },
  };
}

function poolTruth(ctx: SelfTestCtx): CheckResult {
  const failures: string[] = [];
  let n = 0;
  let maxD = 0;
  let maxM = 0;
  let mism = 0;

  for (const p of ctx.pool) {
    const r = checkPitch(p);

    n++;
    maxD = Math.max(maxD, Math.abs(r.dmx), Math.abs(r.dmz));
    maxM = Math.max(maxM, Math.abs(r.dm));
    if (r.truth !== p.absTruth) mism++;
    if (!r.ok) failures.push(`pool ${p.id}`);
  }
  const lines = [`[POOL] ${n} pitches | max |dMid| ${maxD.toFixed(5)} ft (tol 0.01) | ABS truth mismatches ${mism} | max |dMargin| ${maxM.toFixed(4)} in`];

  return { lines, failures, stats: { pitches: n, maxDMid: maxD, truthMismatches: mism, maxDMargin: maxM } };
}

/** Every ABS challenge in the pool: our reconstructed truth must equal the call after review. */
function challenges(ctx: SelfTestCtx): CheckResult {
  const failures: string[] = [];
  const ch = ctx.pool.filter((p) => p.challenge);
  let matched = 0;
  let overturned = 0;

  for (const p of ch) {
    const truth = prep(p).k.judge.strike ? 'strike' : 'ball';
    const orig = p.challenge?.isOverturned ? (p.finalCall === 'strike' ? 'ball' : 'strike') : p.finalCall;

    if (truth === p.finalCall) matched++;
    else failures.push(`challenge ${p.id}`);
    if (p.challenge?.isOverturned) overturned++;
    if (orig !== p.umpCall) failures.push(`challenge call ${p.id}`);
  }

  return {
    lines: [`[ABS CHALLENGES] ${ch.length} challenged pitches | recomputed truth equals the call after review: ${matched}/${ch.length} | overturned ${overturned}`],
    failures,
    stats: { challenges: ch.length, matched, overturned },
  };
}

function timing(ctx: SelfTestCtx): CheckResult {
  const failures: string[] = [];
  let n = 0;
  let fmin = 9;
  let fmax = 0;
  let fsum = 0;
  let outOfBand = 0;

  for (const p of ctx.pool) {
    const fl = prep(p).k.flight;

    n++;
    fmin = Math.min(fmin, fl);
    fmax = Math.max(fmax, fl);
    fsum += fl;
    if (fl < 0.35 || fl > 0.51) outOfBand++;
  }
  if (outOfBand) failures.push('flight band');

  return {
    lines: [
      `[TIMING] release->plate real time: pool ${fmin.toFixed(3)}-${fmax.toFixed(3)} s (mean ${(fsum / n).toFixed(3)}), outside 0.35-0.51 s: ${outOfBand}`,
      '         renderer clock = performance.now() seconds since release mapped 1:1 to traj time (ballT); no slow motion before the call',
    ],
    failures,
    stats: { min: fmin, max: fmax, mean: fsum / n, outOfBand },
  };
}

function pitcherHand(ctx: SelfTestCtx): CheckResult {
  let maxHand = 0;
  const handErr = (P: PreparedPitch): number => {
    const J = pitcherPose(P, 0);

    return Math.hypot(J.tHa.x - P.k.rel.x, J.tHa.y - P.k.rel.y, J.tHa.z - P.k.rel.z);
  };

  for (const P of ctx.todaySet) maxHand = Math.max(maxHand, handErr(P));
  for (const p of ctx.pool) maxHand = Math.max(maxHand, handErr(prep(p)));

  return {
    lines: [`[PITCHER] throwing hand vs real release point at the release instant: max |d| = ${maxHand.toExponential(2)} ft (ten + pool)`],
    failures: maxHand > 1e-9 ? ['hand at release'] : [],
    stats: { maxHand },
  };
}

interface CamSide {
  F: number;
  vfov: number;
  out: number;
  outX: number;
  capPct: number;
  helmetOwn: number;
  helmetExtreme: number;
}

function cameraSide(ctx: SelfTestCtx, W: number, H: number, side: Side, PLAYP: readonly PreparedPitch[], lines: string[], failures: string[]): CamSide {
  const { lens } = ctx;
  const cam = lens.fitCam(W, H, side);
  const Ps = ctx.todaySet.filter((P) => P.batter.side === side);
  const mine = PLAYP.filter((P) => P.batter.side === side);
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;

  for (const P of Ps) {
    const c = lens.camFor(W, H, P);

    for (const zz of [P.zone.top, P.zone.bottom]) {
      for (const xx of [-PLATE_HALF, PLATE_HALF]) {
        const q = c.p({ x: xx, y: MID_Y, z: zz });

        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y0 = Math.min(y0, q.y);
        y1 = Math.max(y1, q.y);
      }
    }
  }
  // the hard constraint: every dealt crossing, ball and air included, inside the frame from its own stance and from
  // every corner of the stance box
  const inFrame = (c: LensCam, P: PreparedPitch): boolean => {
    const q = c.p(P.k.mid);
    const r = (BALL_R + CROSS_PAD) * q.k;

    return q.x - r >= 0 && q.x + r <= W && q.y - r >= 0 && q.y + r <= H;
  };
  let out = 0;
  let cx0 = 1e9;
  let cx1 = -1e9;
  let cy0 = 1e9;
  let cy1 = -1e9;

  for (const P of mine) {
    const c = lens.camFor(W, H, P);
    const q = c.p(P.k.mid);
    const r = BALL_R * q.k;

    cx0 = Math.min(cx0, q.x - r);
    cx1 = Math.max(cx1, q.x + r);
    cy0 = Math.min(cy0, q.y - r);
    cy1 = Math.max(cy1, q.y + r);
    if (!inFrame(c, P)) out++;
  }
  const corners = stanceCorners(side).map((e) => withUnion(makeCam(e, cam.yaw, cam.F, cam.cx, cam.cy, W, H), cam.U));
  let outX = 0;
  let capMin = 1e9;
  let clearX = 1e9;
  const lowest = mine.reduce((a, P) => (P.zone.bottom < a.zone.bottom ? P : a), mine[0]);
  // the catcher keys off the ump, so his helmet holds its place on screen; it must stay under every dealt zone
  const helmClear = (c: LensCam, Pz: PreparedPitch): number => {
    const m = catcherRig(side, c.eye);
    const ring = sphereOutline(c, m.head, m.r, 96);

    // a helmet without an outline can't be shown to clear the zone, so it counts as over it
    if (!ring) return -Infinity;
    const zl = c.p({ x: -PLATE_HALF, y: MID_Y, z: Pz.zone.bottom });
    const zr = c.p({ x: PLATE_HALF, y: MID_Y, z: Pz.zone.bottom });
    let helm = 1e9;

    for (const p of ring) if (p.x >= Math.min(zl.x, zr.x) - 12 && p.x <= Math.max(zl.x, zr.x) + 12) helm = Math.min(helm, p.y);

    return helm - Math.max(zl.y, zr.y);
  };

  for (const c of corners) {
    for (const P of mine) if (!inFrame(c, P)) outX++;
    capMin = Math.min(capMin, c.p({ x: 0, y: RUBBER_Y - 0.75, z: MOUND_H + 6.2 }).y);
    clearX = Math.min(clearX, helmClear(c, lowest));
  }
  let clearOwn = 1e9;

  for (const P of mine) clearOwn = Math.min(clearOwn, helmClear(lens.camFor(W, H, P), P));
  const pTop = cam.p({ x: 0, y: RUBBER_Y - 0.75, z: MOUND_H + 6.2 }).y;
  const pFeet = cam.p({ x: 0, y: RUBBER_Y, z: MOUND_H }).y;
  const rRel = Ps.map((P) => BALL_R * lens.camFor(W, H, P).p(P.k.rel).k);
  const rMid = Ps.map((P) => BALL_R * lens.camFor(W, H, P).p(P.k.mid).k);
  const hb = headSpan(cam, batterRig(Ps[0]));

  lines.push(`[CAMERA ${W}x${H} ${side}HB] F ${cam.F.toFixed(0)}px vFOV ${vfovDeg(cam).toFixed(1)} deg, horizon ${cam.cy.toFixed(0)} | pitcher ${pTop.toFixed(0)}-${pFeet.toFixed(0)} (${(pFeet - pTop).toFixed(0)}px; cap at least ${(100 * capMin / H).toFixed(1)}% below the top from any stance) | zone x ${x0.toFixed(0)}-${x1.toFixed(0)} y ${y0.toFixed(0)}-${y1.toFixed(0)} | dealt crossings x ${cx0.toFixed(0)}-${cx1.toFixed(0)} y ${cy0.toFixed(0)}-${cy1.toFixed(0)}, in frame ${mine.length - out}/${mine.length} from their own stances, ${8 * mine.length - outX}/${8 * mine.length} from the 8 extreme stances | catcher helmet under every dealt zone by ${clearOwn.toFixed(0)}px+ (extreme stances, lowest zone: ${clearX.toFixed(0)}px) | batter helmet y ${hb.t.toFixed(0)}-${hb.b.toFixed(0)} | ball r ${Math.min(...rRel).toFixed(1)}-${Math.max(...rRel).toFixed(1)} -> ${Math.min(...rMid).toFixed(1)}-${Math.max(...rMid).toFixed(1)}px`);
  if (out || outX) failures.push(`crossings out of frame ${W}x${H} ${side}: ${out} own, ${outX} extreme`);
  if (clearOwn <= 0 || clearX <= 0) failures.push(`catcher over zone ${W}x${H} ${side}`);
  if (capMin < 0.05 * H) failures.push(`pitcher cap room ${W}x${H} ${side}`);

  return { F: cam.F, vfov: vfovDeg(cam), out, outX, capPct: (100 * capMin) / H, helmetOwn: clearOwn, helmetExtreme: clearX };
}

function camera(ctx: SelfTestCtx): CheckResult {
  const PLAYP = ctx.pool.filter(playable).map(prep);
  const never = ctx.pool.filter((p) => !playable(p));
  const closestNever = Math.min(...never.map((p) => Math.abs(p.edgeMarginIn)));
  const inBox = ctx.today.every(playable);
  const lines = [ctx.deck.length
    ? `[DEALT] Today's Ten and every "another ten" come from the ${PLAYP.length} of ${ctx.pool.length} pool pitches that cross mid-plate at z ${DEAL_BOX.zMin}-${DEAL_BOX.zMax} ft, |x| < ${DEAL_BOX.xMax} ft (Today's Ten all among them: ${inBox ? 'yes' : 'NO'}); never dealt: ${never.length}, closest of those to flipping ${closestNever.toFixed(1)} in`
    : `[DEALT] Today's Ten: all ${ctx.today.length} cross mid-plate at z ${DEAL_BOX.zMin}-${DEAL_BOX.zMax} ft, |x| < ${DEAL_BOX.xMax} ft: ${inBox ? 'yes' : 'NO'}`];
  const failures: string[] = inBox || ctx.deck.length ? [] : ['today outside the deal box'];
  const stats: Record<string, number> = { dealt: PLAYP.length, neverDealt: never.length, closestNeverIn: closestNever, outOwn: 0, outExtreme: 0, capMinPct: 1e9, helmetMin: 1e9 };

  for (const [W, H] of SIZES) {
    for (const side of SIDES) {
      const r = cameraSide(ctx, W, H, side, PLAYP, lines, failures);

      stats[`F_${W}x${H}_${side}`] = r.F;
      stats[`vfov_${W}x${H}_${side}`] = r.vfov;
      stats.outOwn += r.out;
      stats.outExtreme += r.outX;
      stats.capMinPct = Math.min(stats.capMinPct, r.capPct);
      stats.helmetMin = Math.min(stats.helmetMin, r.helmetOwn, r.helmetExtreme);
    }
  }

  return { lines, failures, stats };
}

/** One lens for the scene: the near foreground defocused, the pitcher in the focal plane, the ball never blurred. */
function depthOfField(ctx: SelfTestCtx): CheckResult {
  const cam = ctx.lens.fitCam(1440, 900, 'R');
  const rhb = ctx.todaySet.find((P) => P.batter.side === 'R') || ctx.todaySet[0];
  const D = batterDof(cam, rhb);
  const dc = cam.p(catcherRig('R').head).d;
  const dm = cam.p({ x: 0, y: CATCH_Y, z: 2.5 }).d;
  const dp = cam.p({ x: 0, y: RUBBER_Y, z: 4 }).d;
  const b3 = dofBlur(cam, 3);
  const b6 = dofBlur(cam, 6);
  const failures = b3 < 15 || b3 > 25 || b6 < 8 || b6 > 14 ? ['depth of field strength'] : [];

  return {
    lines: [`[DOF 1440x900] focus ${DOF.focus} ft: 3 ft -> ${b3.toFixed(1)} px, 6 ft -> ${b6.toFixed(1)} px | batter ${D.dN.toFixed(1)}-${D.dF.toFixed(1)} ft -> ${D.sN.toFixed(1)}-${D.sF.toFixed(1)} px | catcher ${dc.toFixed(1)} ft -> ${dofBlur(cam, dc).toFixed(1)} px | mitt ${dm.toFixed(1)} ft -> ${dofBlur(cam, dm).toFixed(1)} px | pitcher ${dp.toFixed(0)} ft -> ${dofBlur(cam, dp).toFixed(2)} px | ball: never blurred`],
    failures,
    stats: { blur3: b3, blur6: b6, batterNear: D.sN, batterFar: D.sF, catcher: dofBlur(cam, dc), mitt: dofBlur(cam, dm), pitcher: dofBlur(cam, dp) },
  };
}

/** The mask cage stays clear of every dealt crossing, the zone and the indicator (bar plus blur). */
function mask(ctx: SelfTestCtx): CheckResult {
  const lines: string[] = [];
  const failures: string[] = [];
  let total = 0;

  for (const [W, H] of SIZES) {
    for (const side of SIDES) {
      const M = maskGeom(ctx.lens.fitCam(W, H, side));
      const vis = M.t / 2 + M.bl;
      let hits = 0;

      for (const b of M.bars) {
        for (const q of maskSamples(b, M.t)) {
          for (const K of M.keep) if (Math.hypot(Math.max(K.l - q.x, 0, q.x - K.r), Math.max(K.t - q.y, 0, q.y - K.b)) < vis) hits++;
        }
      }
      const bars = M.bars.map((b) => (b.k === 'arc' ? `arc r${b.rho.toFixed(0)}${b.sx ? 'R' : 'L'}` : `side ${b.sx ? 'R' : 'L'} y${b.y0.toFixed(0)}-${b.y1.toFixed(0)}`)).join(', ');

      lines.push(`[MASK] ${W}x${H} ${side}HB: ${bars || 'none'} | clear of crossings, zone, indicator: ${hits ? `NO (${hits})` : 'yes'}`);
      if (hits) failures.push(`mask ${W}x${H} ${side}`);
      total += hits;
    }
  }

  return { lines, failures, stats: { hits: total } };
}

/** The glove never leads the ball: its share of the reach when the ball crosses mid-plate, and never over the zone. */
function mitt(ctx: SelfTestCtx): CheckResult {
  const lines: string[] = [];
  const failures: string[] = [];
  const ALLP = ctx.pool.map(prep);
  const PLAYP = ctx.pool.filter(playable).map(prep);
  let maxProg = 0;
  let progBad = 0;
  let overTotal = 0;

  for (const P of ALLP) {
    const e = mittProgress(P, P.k.toMid);

    maxProg = Math.max(maxProg, e);
    if (e > 0.25) progBad++;
  }
  lines.push(`[MITT] glove progress (setup -> catch) when the ball crosses mid-plate: max ${(100 * maxProg).toFixed(1)}% (limit 25%), over the limit: ${progBad} (all ${ALLP.length}, Today's Ten included)`);
  if (progBad) failures.push('mitt leads the ball');
  for (const [W, H] of [[1440, 900], [1024, 768], [390, 844]] as const) {
    let over = 0;

    for (const P of PLAYP) {
      const cam = ctx.lens.camFor(W, H, P);
      const q = cam.p(P.k.mid);
      const r = BALL_R * q.k + 2;
      const zt = cam.p({ x: -PLATE_HALF, y: MID_Y, z: P.zone.top });
      const zb = cam.p({ x: PLATE_HALF, y: MID_Y, z: P.zone.bottom });

      for (const s of [-1, P.k.toMid]) {
        const g = mittBox(cam, P, s);
        const hit = (l: number, t: number, rr: number, b: number): boolean => !!g && g.r > l && g.l < rr && g.b > t && g.t < b;

        if (hit(q.x - r, q.y - r, q.x + r, q.y + r) || hit(Math.min(zt.x, zb.x), zt.y, Math.max(zt.x, zb.x), zb.y)) {
          over++;
          break;
        }
      }
    }
    lines.push(`[MITT] ${W}x${H}: glove over the zone or the crossing before the ball crosses: ${over}/${PLAYP.length}`);
    if (over) failures.push(`mitt over zone ${W}x${H}`);
    overTotal += over;
  }

  return { lines, failures, stats: { maxProgress: maxProg, overLimit: progBad, overZone: overTotal } };
}

/** Framing: after the catch only, 1-4 in toward the zone, strikes and balls alike, and not every borderline pitch. */
function framing(ctx: SelfTestCtx): CheckResult {
  const ALLP = ctx.pool.map(prep);
  let border = 0;
  let bS = 0;
  let framed = 0;
  let fS = 0;
  let fB = 0;
  let sizeBad = 0;
  let dirBad = 0;
  let early = 0;
  let late = 0;
  let fMin = 9;
  let fMax = 0;

  for (const P of ALLP) {
    const isB = Math.abs(P.k.judge.marginIn) <= FRAME.band;
    const q = frameOf(P);

    if (isB) {
      border++;
      if (P.k.judge.strike) bS++;
    }
    if (!q) continue;
    framed++;
    if (P.k.judge.strike) fS++;
    else fB++;
    const sz = frameShift(P, 0.44) * 12;

    fMin = Math.min(fMin, sz);
    fMax = Math.max(fMax, sz);
    if (!isB || sz < FRAME.minIn - 1e-9 || sz > FRAME.maxIn + 1e-9) sizeBad++;
    if (FRAME.t0 + q.dur > 0.45) late++;
    // toward the zone: the framed spot is deeper inside (or less far outside) the zone than the real crossing
    if (absJudge(P.k.mid.x + q.dx * sz / 12, P.k.mid.z + q.dz * sz / 12, P.zone.top, P.zone.bottom).marginIn <= P.k.judge.marginIn) dirBad++;
    // nothing moves before the catch: the glove's path up to and at the catch is identical with framing switched off
    const ss = [-1, P.k.toMid, P.k.toCatch - 0.02, P.k.toCatch - 1e-4, P.k.toCatch, P.k.toCatch + FRAME.t0];
    const withF = ss.map((s) => mittState(P, s).p);
    const noF = ss.map((s) => mittState(P, s, null).p);

    if (withF.some((p, k) => p.x !== noF[k].x || p.y !== noF[k].y || p.z !== noF[k].z)) early++;
  }
  const failures = sizeBad || dirBad || early || late || !fS || !fB || framed === border ? ['framing'] : [];

  return {
    lines: [`[FRAMING] borderline (within ${FRAME.band} in): ${border} pitches (${bS} strikes, ${border - bS} balls) | framed ${framed} = ${(100 * framed / border).toFixed(0)}% of them: ${fS} strikes, ${fB} balls | size ${fMin.toFixed(2)}-${fMax.toFixed(2)} in (bounds ${FRAME.minIn}-${FRAME.maxIn}), out of bounds ${sizeBad}, not toward the zone ${dirBad}, done after the hold ${late} | glove moved by framing before the catch: ${early} pitches`],
    failures,
    stats: { border, borderStrikes: bS, framed, framedStrikes: fS, framedBalls: fB, sizeMin: fMin, sizeMax: fMax, sizeBad, dirBad, early, late },
  };
}

/** The ump's stance: seeded per plate appearance and pitch, bounded, identical on every replay and re-seed. */
function stance(ctx: SelfTestCtx): CheckResult {
  const { lens } = ctx;
  const lines: string[] = [];
  const failures: string[] = [];
  const ALLP = ctx.pool.map(prep);
  let same = 0;
  let inBox = 0;
  const ok = (a: number, m: number): boolean => Math.abs(a) <= m + 1e-12;

  for (const p of ctx.pool) {
    const a = stanceOf(prep(p));
    const b = stanceOf(prep(p));

    if (a.x === b.x && a.y === b.y && a.z === b.z) same++;
    if (ok(a.x, STANCE_MAX.x) && ok(a.y, STANCE_MAX.y) && ok(a.z, STANCE_MAX.z)) inBox++;
  }
  const appSame = ctx.todaySet.every((P, k) => {
    const a = eyeOf(P);
    const b = eyeOf(prep(ctx.today[k]));
    const c = lens.camFor(1440, 900, P).eye;

    return a.x === b.x && a.y === b.y && a.z === b.z && c.x === a.x && c.y === a.y && c.z === a.z;
  });
  const hs = ALLP.map((P) => P.batter.heightFt);
  const zs = ALLP.map((P) => stanceOf(P).z);
  const mh = hs.reduce((s, v) => s + v, 0) / hs.length;
  const mz = zs.reduce((s, v) => s + v, 0) / zs.length;
  const cov = hs.reduce((s, v, k) => s + (v - mh) * (zs[k] - mz), 0);
  const corr = cov / Math.sqrt(hs.reduce((s, v) => s + (v - mh) ** 2, 0) * zs.reduce((s, v) => s + (v - mz) ** 2, 0));

  lines.push(`[STANCE] per plate appearance: lateral ±${STANCE.paX} in, depth ±${STANCE.paY} in, height ±${STANCE.paZ} in (${STANCE.follow} in of it following the batter's height, r = ${corr.toFixed(2)}); per pitch ±${STANCE.pitch} in on each axis | deterministic: ${same}/${ctx.pool.length} identical on re-seed, Today's Ten app = fresh = camera eye: ${appSame ? 'yes' : 'NO'} | inside the box: ${inBox}/${ctx.pool.length}`);
  if (same !== ctx.pool.length || inBox !== ctx.pool.length || !appSame) failures.push('stance');
  // how much the stance moves the view at 1440x900, Today's Ten (inches at the plate = px × depth / F)
  const rows = ctx.todaySet.map((P) => {
    const c = lens.camFor(1440, 900, P);
    const b = lens.fitCam(1440, 900, P.batter.side);
    const st = stanceOf(P);
    const xi = P.batter.side === 'R' ? -PLATE_HALF : PLATE_HALF;
    const zm = (P.zone.top + P.zone.bottom) / 2;
    const ie = c.p({ x: xi, y: MID_Y, z: zm });
    const ie0 = b.p({ x: xi, y: MID_Y, z: zm });
    const zb = c.p({ x: 0, y: MID_Y, z: P.zone.bottom });
    const zb0 = b.p({ x: 0, y: MID_Y, z: P.zone.bottom });
    const pp = c.p({ x: 0, y: RUBBER_Y, z: MOUND_H + 3 });
    const pp0 = b.p({ x: 0, y: RUBBER_Y, z: MOUND_H + 3 });

    return { P, st, ie: ie.x, ie0: ie0.x, ieIn: ie.d * 12 / c.F, zb: zb.y, zb0: zb0.y, zbIn: zb.d * 12 / c.F, pdx: pp.x - pp0.x, pdy: pp.y - pp0.y };
  });

  rows.forEach((r, k) => lines.push(`  ${String(k + 1).padStart(2)} ${lastName(r.P.batter.name).padEnd(9)} ${r.P.batter.side}HB | stance x ${f(r.st.x * 12, 2)} y ${f(r.st.y * 12, 2)} z ${f(r.st.z * 12, 2)} in | inside edge x ${r.ie.toFixed(0)} px (slot ${r.ie0.toFixed(0)}) | zone bottom y ${r.zb.toFixed(0)} px (slot ${r.zb0.toFixed(0)}) | pitcher ${f(r.pdx, 1)}, ${f(r.pdy, 1)} px`));
  const spread = (a: readonly number[]): number => Math.max(...a) - Math.min(...a);
  const stats: Record<string, number> = { same, inBox, appSame: appSame ? 1 : 0, heightCorr: corr };
  const sideLine = (sd: Side): string => {
    const R = rows.filter((r) => r.P.batter.side === sd);
    const ip = R[0].ieIn;
    const ie = spread(R.map((r) => r.ie));
    const zb = spread(R.map((r) => r.zb));
    const zb0 = spread(R.map((r) => r.zb0));

    stats[`insideSpread_${sd}`] = ie;
    stats[`bottomSpread_${sd}`] = zb;

    return `${sd}HB (${R.length}): inside edge spread ${ie.toFixed(0)} px = ${(ie * ip).toFixed(1)} in at the plate (from the fixed slot: 0) | zone bottom spread ${zb.toFixed(0)} px = ${(zb * R[0].zbIn).toFixed(1)} in (from the fixed slot, batter height alone: ${zb0.toFixed(0)} px)`;
  };
  const pm = Math.max(...rows.map((r) => Math.hypot(r.pdx, r.pdy)));

  stats.pitcherMovePx = pm;
  lines.push(`[STANCE 1440x900] Today's Ten | ${sideLine('R')} | ${sideLine('L')} | pitcher moves at most ${pm.toFixed(1)} px from the slot's view (spread x ${spread(rows.map((r) => r.pdx)).toFixed(1)}, y ${spread(rows.map((r) => r.pdy)).toFixed(1)} px)`);

  return { lines, failures, stats };
}

/** "Another ten": dealt like Today's Ten, from seeded draws so the report is stable. */
function picker(ctx: SelfTestCtx): CheckResult {
  let pickBad = 0;
  let pickUmp = 0;
  let pickCh = 0;
  let pickGames = 0;
  let cbMin = 9;
  let cbMax = 0;
  const pr = mulberry32(20261031);
  const todayIds = new Set(ctx.today.map((p) => p.id));

  for (let r = 0; r < 200; r++) {
    const s = pickPoolTen(ctx.deck, ctx.today, pr);
    const ids = new Set(s.map((p) => p.id));
    const m = s.map((p) => Math.abs(p.edgeMarginIn));
    const close = s.filter((_p, k) => m[k] <= CLOSE_IN);
    const cb = close.filter((p) => p.absTruth === 'ball').length;

    if (s.length !== 10 || ids.size !== 10 || s.some((p) => !p || !playable(p) || todayIds.has(p.id)) || m[0] < 6
      || close.length !== 8 || !s.some((p) => p.challenge) || m.slice(1).some((v) => v > 4.5)) pickBad++;
    cbMin = Math.min(cbMin, cb);
    cbMax = Math.max(cbMax, cb);
    pickUmp += s.filter((p) => p.umpCorrect).length;
    pickCh += s.filter((p) => p.challenge).length;
    pickGames += new Set(s.map((p) => p.gamePk)).size;
  }
  const failures = pickBad || cbMin === cbMax ? ['pool picker'] : [];

  return {
    lines: [`[PLAY ANOTHER TEN] 200 draws: invalid ${pickBad} | each: calibrator (6+ in) first, 8 close calls within ${CLOSE_IN} in (balls among them: ${cbMin}-${cbMax}, so counting is no tell), 1 more within 4.5 in, >= 1 ABS challenge (${(pickCh / 200).toFixed(1)} on average), from ${(pickGames / 200).toFixed(1)} games on average | real ump right ${(pickUmp / 200).toFixed(1)}/10 on average`],
    failures,
    stats: { invalid: pickBad, closeBallsMin: cbMin, closeBallsMax: cbMax, umpMean: pickUmp / 200, challengesMean: pickCh / 200, gamesMean: pickGames / 200 },
  };
}

export const CHECKS: readonly Check[] = [
  { id: 'today', name: "Today's Ten: crossing, truth and timing per pitch", run: todayPitches },
  { id: 'makeup', name: "Today's Ten: make-up and the real ump's tally", run: todayMakeUp },
  { id: 'pool', name: 'Pool: crossing and ABS truth for all pitches', run: poolTruth },
  { id: 'challenges', name: 'ABS challenges: truth equals the call after review', run: challenges },
  { id: 'timing', name: 'Release-to-plate times', run: timing },
  { id: 'hand', name: "Pitcher's hand pinned to the release point", run: pitcherHand },
  { id: 'camera', name: "Camera: dealt crossings in frame, pitcher's cap and catcher's helmet at 5 sizes and 8 extreme stances", run: camera },
  { id: 'dof', name: 'Depth-of-field strength', run: depthOfField },
  { id: 'mask', name: 'Mask clearance', run: mask },
  { id: 'mitt', name: 'Mitt: at most 25% of its reach before the crossing, never over the zone', run: mitt },
  { id: 'framing', name: 'Framing bounds', run: framing },
  { id: 'stance', name: 'Stance determinism and bounds', run: stance },
  { id: 'picker', name: '"Another ten" picker', run: picker },
];

/** The season's report: the checks that hold for one date's Ten (seasonSelfTestContext). */
export const SEASON_CHECKS: readonly Check[] = [
  ...CHECKS.filter((c) => c.id === 'today'),
  { id: 'rules', name: "Today's Ten: the dealer's and the schedule's rules, and the real ump's tally", run: todayRules },
  ...CHECKS.filter((c) => ['hand', 'camera', 'dof', 'mask', 'mitt', 'stance'].includes(c.id)),
];

/** Runs the checks in the mockup's report order. */
export function runSelfTest(ctx: SelfTestCtx, checks: readonly Check[] = CHECKS): { lines: string[]; failures: string[] } {
  const lines = ["UMPIRE'S EYE SELF-TEST"];
  const failures: string[] = [];
  const gaps = new Set(['today', 'pool', 'hand', 'camera', 'mitt']);

  for (const c of checks) {
    if (gaps.has(c.id)) lines.push('');
    const r = c.run(ctx);

    lines.push(...r.lines);
    failures.push(...r.failures);
  }
  lines.push('');
  lines.push(failures.length ? `RESULT: FAIL (${failures.length}) ${failures.slice(0, 12).join(', ')}` : 'RESULT: PASS');

  return { lines, failures };
}
