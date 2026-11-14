import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { absJudge, inDealBox } from '../../../src/core/abs.ts';
import { crossing, type Traj } from '../../../src/core/kinematics.ts';

// The mockup's self-test guarantees, kept as a test: the same math must reproduce its validated World Series pool
// (742 called pitches, 29 of 29 challenges, the ump right on 683). The pool is our own derived file, not an MLB response.
const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'art', 'data', 'ws-2026-pool.json');

interface MockupPitch {
  id: string;
  traj: Traj;
  zone: { top: number; bottom: number };
  absTruth: 'strike' | 'ball';
  edgeMarginIn: number;
  umpCall: 'strike' | 'ball';
  finalCall: 'strike' | 'ball';
  challenge: object | null;
}

test('reproduces the mockup World Series pool', () => {
  const pitches = (JSON.parse(readFileSync(file, 'utf8')) as { pitches: MockupPitch[] }).pitches;
  const judged = pitches.map((p) => {
    const mid = crossing(p.traj);
    const j = absJudge(mid.x, mid.z, p.zone.top, p.zone.bottom);

    return { p, truth: j.strike ? 'strike' : 'ball', marginIn: j.marginIn, inBox: inDealBox(mid) };
  });
  const challenged = judged.filter((j) => j.p.challenge);
  const undealt = judged.filter((j) => !j.inBox);

  assert.equal(pitches.length, 742);
  assert.deepEqual(
    judged.filter((j) => j.truth !== j.p.absTruth || Math.abs(j.marginIn - j.p.edgeMarginIn) > 0.011).map((j) => j.p.id),
    [],
  );
  assert.equal(judged.filter((j) => j.truth === j.p.umpCall).length, 683);
  assert.equal(challenged.length, 29);
  assert.equal(challenged.filter((j) => j.truth === j.p.finalCall).length, 29);
  assert.equal(judged.length - undealt.length, 590);
  assert.ok(Math.min(...undealt.map((j) => Math.abs(j.marginIn))) >= 6.55);
});
