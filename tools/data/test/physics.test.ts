import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALL_R, MID_Y, PLATE_FRONT_Y, PLATE_HALF } from '../lib/constants.ts';
import { absJudge, boxStrike, crossing, inDealBox, posAt, tAtY } from '../lib/physics.ts';
import { hash32, mulberry32 } from '../lib/rng.ts';
import { trajThrough, ZONE } from './fixtures.ts';

const close = (a: number, b: number, tol: number): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('tAtY finds the time the ball reaches a plane, negative behind y0', () => {
  const tr = { x0: -1.8, y0: 50, z0: 5.9, vX0: 6, vY0: -136, vZ0: -4, aX: -12, aY: 29, aZ: -20 };

  for (const y of [PLATE_FRONT_Y, MID_Y, 0, 54]) close(posAt(tr, tAtY(tr, y)).y, y, 1e-9);
  assert.ok(tAtY(tr, 54) < 0);
  close(tAtY({ ...tr, aY: 0 }, MID_Y), (50 - MID_Y) / 136, 1e-12);
});

test('absJudge: any part of the ball touching the zone is a strike', () => {
  const judge = (x: number, z = 2.5) => absJudge(x, z, ZONE.top, ZONE.bottom);

  close(judge(0).marginIn, 1.45 + 8.5, 1e-9);
  assert.equal(judge(PLATE_HALF + BALL_R - 1e-12).strike, true);
  close(judge(PLATE_HALF + BALL_R - 1e-12).marginIn, 0, 1e-9);
  assert.equal(judge(PLATE_HALF + BALL_R + 0.01 / 12).strike, false);
  close(judge(PLATE_HALF + BALL_R + 0.01 / 12).marginIn, -0.01, 1e-9);
  assert.equal(judge(-(PLATE_HALF + BALL_R + 0.01 / 12)).strike, false);
  assert.equal(absJudge(0, ZONE.bottom - BALL_R + 0.001, ZONE.top, ZONE.bottom).strike, true);
});

test('absJudge rounds the corners where the box rule does not', () => {
  const d = 0.8 * BALL_R;
  const x = PLATE_HALF + d;
  const z = ZONE.top + d;

  assert.equal(absJudge(x, z, ZONE.top, ZONE.bottom).strike, false);
  assert.equal(boxStrike(x, z, ZONE.top, ZONE.bottom), true);
  close(absJudge(x, z, ZONE.top, ZONE.bottom).marginIn, (BALL_R - Math.hypot(d, d)) * 12, 1e-9);
});

test('ignoring the ball radius turns edge strikes into balls', () => {
  assert.equal(absJudge(PLATE_HALF + BALL_R / 2, 2.5, ZONE.top, ZONE.bottom, 0).strike, false);
});

test('inDealBox is the mockup crossing box, bounds excluded', () => {
  assert.equal(inDealBox({ x: 0, z: 0.9 }), false);
  assert.equal(inDealBox({ x: 0, z: 0.9001 }), true);
  assert.equal(inDealBox({ x: 0, z: 4.5 }), false);
  assert.equal(inDealBox({ x: -1.5, z: 2 }), false);
  assert.equal(inDealBox({ x: 1.4999, z: 2 }), true);
});

test('the fixture trajectory crosses mid-plate where it is asked to', () => {
  const mid = crossing(trajThrough(0.75, 1.7));

  close(mid.x, 0.75, 1e-12);
  close(mid.z, 1.7, 1e-12);
});

test('hash32 is FNV-1a', () => {
  assert.equal(hash32(''), 0x811c9dc5);
  assert.equal(hash32('a'), 0xe40c292c);
  assert.equal(hash32('foobar'), 0xbf9cf968);
});

test('mulberry32 is deterministic per seed and roughly uniform', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const draws = Array.from({ length: 10_000 }, () => a());
  const mean = draws.reduce((s, v) => s + v, 0) / draws.length;

  assert.deepEqual(Array.from({ length: 5 }, () => b()), draws.slice(0, 5));
  assert.notEqual(c(), draws[0]);
  assert.ok(draws.every((v) => v >= 0 && v < 1));
  close(mean, 0.5, 0.02);
});
