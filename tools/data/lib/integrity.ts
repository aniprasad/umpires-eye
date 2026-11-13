import type { StoredPitch } from './decode.ts';
import { TRAJ_KEYS } from './physics.ts';

// Integrity findings that fail data:build and data:validate. Each kind lists its findings as text that starts with the
// pitch or plate appearance it is about.
export const FAILING_KINDS = [
  'countMismatches',
  'outsMismatches',
  'scoreMismatches',
  'runnersMismatches',
  'impossibleCounts',
  'challengesOnExcludedPitches',
  'orphanChallenges',
  'challengeRoleAnomalies',
  'challengeMismatches',
  'umpireProblems',
  'dealableWithoutBatterHeight',
  'dealableWithoutPitchType',
] as const;

export type FailingKind = (typeof FAILING_KINDS)[number];

// Feed errors checked by hand and documented in docs/DATA.md. Anything else fails the build.
export const ALLOWED: Readonly<Partial<Record<FailingKind, readonly string[]>>> = {
  // The feed's count reaches three strikes (0-3, then 2-3) without ending this plate appearance; both stay undealable.
  impossibleCounts: ['824212-42-5', '824212-42-9'],
  // A batter's challenge of a called strike, upheld, which the reconstruction has as a ball by 0.76 in.
  challengeMismatches: ['825000-30-3'],
};

export interface Verdict {
  failures: string[];
  allowed: string[];
  // Pins that matched nothing: worth removing, but not a failure.
  stale: string[];
}

export const findingId = (finding: string): string => /^\d+-\d+(?:-\d+)?/.exec(finding)?.[0] ?? finding;

export const isAllowed = (kind: FailingKind, id: string, allowed = ALLOWED): boolean => (allowed[kind] ?? []).includes(id);

export function judgeFindings(findings: Partial<Record<FailingKind, readonly string[]>>, allowed = ALLOWED): Verdict {
  const verdict: Verdict = { failures: [], allowed: [], stale: [] };
  const matched = new Set<string>();

  for (const kind of FAILING_KINDS) {
    for (const finding of findings[kind] ?? []) {
      const id = findingId(finding);

      if (isAllowed(kind, id, allowed)) {
        verdict.allowed.push(`${kind}: ${finding}`);
        matched.add(`${kind}|${id}`);
      } else {
        verdict.failures.push(`${kind}: ${finding}`);
      }
    }
  }
  for (const kind of FAILING_KINDS) {
    for (const id of allowed[kind] ?? []) if (!matched.has(`${kind}|${id}`)) verdict.stale.push(`${kind}: ${id}`);
  }

  return verdict;
}

export interface ShardIndex {
  // Game position in the shard's games table.
  games: Map<number, number>;
  heights: Map<number, number | null>;
  types: Set<string>;
  umpires: Map<number, string>;
}

const isInt = (v: unknown): boolean => Number.isInteger(v);
const inRange = (v: number, lo: number, hi: number): boolean => Number.isInteger(v) && v >= lo && v <= hi;

// What data:validate checks on each stored pitch, from the shard alone.
export function pitchProblems(p: StoredPitch, index: ShardIndex): string[] {
  const out: string[] = [];
  const role = p.challenge?.role;

  if (![p.gamePk, p.atBat, p.pitch, p.batter, p.pitcher].every(isInt)) out.push('ids are not integers');
  if (!index.games.has(p.gamePk)) out.push('game missing from the games table');
  if (!index.heights.has(p.batter) || !index.heights.has(p.pitcher)) out.push('batter or pitcher missing from the players table');
  if (p.challenge && !index.heights.has(p.challenge.by)) out.push('challenger missing from the players table');
  if (p.umpire !== null && !index.umpires.has(p.umpire)) out.push(`plate umpire ${p.umpire} missing from the umpires table`);
  if (p.type !== null && !index.types.has(p.type)) out.push(`pitch type ${p.type} missing from pitchTypes`);
  if (!(p.inning >= 1 && isInt(p.inning)) || !inRange(p.outs, 0, 2)) out.push('bad inning or outs');
  if (!inRange(p.balls, 0, 9) || !inRange(p.strikes, 0, 9)) out.push(`bad count ${p.balls}-${p.strikes}`);
  if (!inRange(p.awayScore, 0, 99) || !inRange(p.homeScore, 0, 99) || !inRange(p.bases, 0, 7)) out.push('bad score or bases');
  if (!['L', 'R'].includes(p.bats) || !['L', 'R'].includes(p.throws)) out.push('bad batter side or pitcher hand');
  if (![p.ump, p.final, p.abs].every((c) => c === 'S' || c === 'B')) out.push('bad call code');
  if (!TRAJ_KEYS.every((k) => Number.isFinite(p.traj[k])) || p.traj.vY0 >= 0) out.push('bad trajectory');
  if (!(p.zoneBottom > 0 && p.zoneTop > p.zoneBottom) || !Number.isFinite(p.marginIn)) out.push('bad zone or margin');
  if (p.challenge === null ? p.ump !== p.final : p.challenge.overturned !== (p.ump !== p.final)) {
    out.push('ump and final calls disagree with the challenge record');
  }
  // Only the batter may challenge a strike, and only the pitcher or catcher a ball.
  if (role && (role === 'B') !== (p.ump === 'S')) out.push(`role ${role} challenged a called ${p.ump}`);
  if (p.challenge && p.abs !== p.final && !isAllowed('challengeMismatches', p.id)) {
    out.push('the ABS reconstruction differs from the final call after a challenge');
  }
  if (p.dealable) {
    // A feed scoring error can leave an impossible count; such a pitch may sit in the pool only as an undealable challenge.
    if (p.balls > 3 || p.strikes > 2) out.push(`dealable with an impossible count ${p.balls}-${p.strikes}`);
    if ((index.heights.get(p.batter) ?? null) === null) out.push('dealable without a batter height');
    if (p.type === null) out.push('dealable without a pitch type');
  }

  return out;
}
