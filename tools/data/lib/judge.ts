import { MID_Y } from './constants.ts';
import { absJudge, crossing, isDealable, type Point } from './physics.ts';
import type { Call, CalledPitch } from './plays.ts';

export interface Judged {
  p: CalledPitch;
  seq: number;
  mid: Point;
  truth: Call;
  marginIn: number;
  // The mockup's crossing rule, judged at full precision.
  dealable: boolean;
  // The app can draw it: release extension and speed are known, and so are the batter and pitcher.
  renderable: boolean;
}

export function judge(p: CalledPitch, seq: number): Judged {
  const mid = crossing(p.traj, MID_Y);
  const j = absJudge(mid.x, mid.z, p.zoneTop, p.zoneBottom);

  return {
    p,
    seq,
    mid,
    truth: j.strike ? 'S' : 'B',
    marginIn: j.marginIn,
    dealable: isDealable(mid),
    renderable: p.extension !== null && p.mph !== null && p.attribution !== 'uncertain',
  };
}
