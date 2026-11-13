import { absJudge, inDealBox } from '../../../src/core/abs.ts';
import { crossing, flightTime, quickEnough, type Vec3 } from '../../../src/core/kinematics.ts';
import { MID_Y } from '../../../src/core/rules.ts';
import type { Call, CalledPitch } from './plays.ts';

export interface Judged {
  p: CalledPitch;
  seq: number;
  mid: Vec3;
  truth: Call;
  marginIn: number;
  // The mockup's crossing box, judged at full precision. Only a pitch that is also showable is dealable.
  inBox: boolean;
  // Seconds from release to the front of the plate, when the release extension is known.
  flightS: number | null;
  // The app can show it as it happened: release extension and speed are known, so are the batter and pitcher, the
  // count before the pitch is one that can occur (a feed scoring error can make it 0-3), and the pitch is quick
  // enough to stay in the app's frame.
  showable: boolean;
}

export const countPossible = (p: CalledPitch): boolean => p.balls <= 3 && p.strikes <= 2;

export function judge(p: CalledPitch, seq: number): Judged {
  const mid = crossing(p.traj, MID_Y);
  const j = absJudge(mid.x, mid.z, p.zoneTop, p.zoneBottom);
  const quick = p.extension !== null && quickEnough(p.traj, p.extension);

  return {
    p,
    seq,
    mid,
    truth: j.strike ? 'S' : 'B',
    marginIn: j.marginIn,
    inBox: inDealBox(mid),
    flightS: p.extension === null ? null : flightTime(p.traj, p.extension),
    showable: quick && p.mph !== null && p.attribution !== 'uncertain' && countPossible(p),
  };
}
