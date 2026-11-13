import type { Pitch } from '../../src/math/types';

/** A small synthetic pitch: a 130 ft/s fastball down the middle. Override what a test cares about. */
export function synthPitch(over: Partial<Pitch> = {}): Pitch {
  const base: Pitch = {
    id: '1-1-1',
    gamePk: 1,
    gameNumber: 1,
    inning: 1,
    half: 'top',
    outs: 0,
    countBefore: { balls: 0, strikes: 0 },
    score: { away: 0, home: 0 },
    runnersOn: [],
    batter: { id: 10, name: 'Sam Example', side: 'R', heightFt: 6 },
    pitcher: { id: 20, name: 'Pat Sample', hand: 'R' },
    pitchType: { code: 'FF', name: 'Four-Seam Fastball', family: 'fastball' },
    startSpeed: 95,
    extension: 6.5,
    flightTime: 0.4,
    traj: { x0: 0, y0: 50, z0: 5, vX0: 0, vY0: -130, vZ0: -5, aX: 0, aY: 25, aZ: -20 },
    release: { x: 0, y: 54, z: 5.2, t: -0.03 },
    mid: { x: 0, z: 2.5, t: 0.38 },
    zone: { top: 3.2, bottom: 1.6 },
    absTruth: 'strike',
    edgeMarginIn: 5,
    umpCall: 'strike',
    finalCall: 'strike',
    umpCorrect: true,
    challenge: null,
  };

  return { ...base, ...over };
}
