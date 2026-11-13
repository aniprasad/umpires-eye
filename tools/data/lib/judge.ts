import { MID_Y } from './constants.ts';
import { absJudge, crossing, inDealBox, type Point } from './physics.ts';
import type { Call, CalledPitch } from './plays.ts';

export interface Judged {
  p: CalledPitch;
  seq: number;
  mid: Point;
  truth: Call;
  marginIn: number;
  // The mockup's crossing box, judged at full precision. Only a pitch that is also showable is dealable.
  inBox: boolean;
  // The app can show it as it happened: release extension and speed are known, so are the batter and pitcher, and the
  // count before the pitch is one that can occur (a feed scoring error can make it 0-3).
  showable: boolean;
}

export const countPossible = (p: CalledPitch): boolean => p.balls <= 3 && p.strikes <= 2;

export function judge(p: CalledPitch, seq: number): Judged {
  const mid = crossing(p.traj, MID_Y);
  const j = absJudge(mid.x, mid.z, p.zoneTop, p.zoneBottom);

  return {
    p,
    seq,
    mid,
    truth: j.strike ? 'S' : 'B',
    marginIn: j.marginIn,
    inBox: inDealBox(mid),
    showable: p.extension !== null && p.mph !== null && p.attribution !== 'uncertain' && countPossible(p),
  };
}
