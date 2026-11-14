import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isDailyReserve, varietyProblems, type DailyDoc } from '../../../src/core/daily.ts';
import { tenProblems } from '../../../src/core/deal.ts';
import { decodeTables } from '../../../src/core/decode.ts';
import { DAILY_FORMAT } from '../../../src/core/schema.ts';
import { DAILY_REPORT_PATH, generateDaily, readSeason, type DailyRun } from '../lib/daily.ts';
import { readText } from '../lib/files.ts';
import { OUT_DIR } from '../lib/pipeline.ts';
import { atBatFor, daily, idOf, manifestOf, monthsOf, poolFor, synthSeason, withDaily, type SynthGame, type SynthPitch } from './daily-fixtures.ts';

const pool = poolFor(40);
const season = synthSeason(pool.games, pool.pitches);
const first = daily(season, { from: '2026-11-01', through: '2026-12-10' });

const docsOf = (run: DailyRun): DailyDoc[] => [...monthsOf(run).values()].map((text) => JSON.parse(text) as DailyDoc);
const daysOf = (run: DailyRun) => Object.assign({}, ...docsOf(run).map((d) => d.days)) as DailyDoc['days'];
const idsOn = (run: DailyRun, date: string): readonly string[] => daysOf(run)[date]?.ids ?? [];
/** The season again, as data:build would rebuild it after these changes to the pool. */
const rebuilt = (change: (pitches: SynthPitch[]) => SynthPitch[]) => synthSeason(pool.games, change([...pool.pitches]));
const without = (...ids: string[]) => rebuilt((ps) => ps.filter((p) => !ids.includes(idOf(p))));
/** data:daily again on `next`, with the first run's month files as its lock and its daily block in the manifest. */
const again = (next = season, args = {}, run = first): DailyRun => daily(next, args, monthsOf(run), withDaily(next, run));

test('every date gets ten reserved, dealable pitches, none twice, keeping the round and the variety rules', () => {
  const s = readSeason(JSON.parse(season.manifestText), season.shardTexts);
  const days = Object.entries(daysOf(first));
  const ids = days.flatMap(([, d]) => d.ids);

  assert.equal(days.length, 40);
  assert.deepEqual(days.map(([date]) => date), Object.keys(daysOf(first)).sort());
  assert.equal(new Set(ids).size, 400);
  for (const [date, day] of days) {
    const cards = day.ids.flatMap((id) => s.pitches.get(id) ?? []);

    assert.ok(day.available, date);
    assert.ok(cards.every((c) => c.dealable && isDailyReserve(c.id)), date);
    assert.deepEqual([...tenProblems(cards), ...varietyProblems(cards)], [], date);
  }
});

test('a month file holds its available days\' rows exactly as their shards do, and only what they reference', () => {
  const shardRows = new Map(
    [...season.shardTexts.values()].flatMap((t) => (JSON.parse(t) as DailyDoc).pitches.map((r): [string, string] => [`${r[0]}-${r[1]}-${r[2]}`, JSON.stringify(r)])),
  );

  for (const doc of docsOf(first)) {
    const tables = decodeTables(doc, DAILY_FORMAT);
    const scheduled = Object.values(doc.days).flatMap((d) => d.ids);

    assert.equal(doc.build, season.build);
    assert.deepEqual(tables.pitches.map((p) => p.id), scheduled);
    for (const row of doc.pitches) assert.equal(JSON.stringify(row), shardRows.get(`${row[0]}-${row[1]}-${row[2]}`));
    assert.deepEqual(tables.games.map((g) => g.gamePk).sort(), [...new Set(tables.pitches.map((p) => p.gamePk))].sort());
    assert.deepEqual([...tables.players.keys()], [...new Set(tables.pitches.flatMap((p) => [p.batter, p.pitcher, ...(p.challenge ? [p.challenge.by] : [])]))].sort((a, b) => a - b));
    assert.deepEqual(Object.keys(doc.pitchTypes), [...new Set(tables.pitches.map((p) => p.type))].sort());
  }
});

test('the same inputs give the same bytes, and a run on its own output changes nothing', () => {
  assert.deepEqual([...daily(season, { from: '2026-11-01', through: '2026-12-10' }).files], [...first.files]);
  assert.deepEqual([...again().files], [...first.files]);
  assert.deepEqual([...again(season, { check: true }).files], [...first.files]);
});

test('adding pitches, or removing one no day holds, leaves every scheduled day as it was', () => {
  const held = new Set(Object.values(daysOf(first)).flatMap((d) => d.ids));
  const spare = pool.pitches.find((p) => p.dealable !== false && isDailyReserve(idOf(p)) && !held.has(idOf(p)));
  const added: SynthPitch = { gamePk: 910_003, atBat: atBatFor(910_003, 900), marginIn: 0.3, challenged: true, bats: 'L' };
  const next = rebuilt((ps) => [...ps.filter((p) => p !== spare), added]);

  assert.ok(spare);
  assert.notEqual(next.build, season.build);
  assert.deepEqual(daysOf(again(next)), daysOf(first));
});

test('a served day that loses a pitch stays, unavailable, with its IDs; none is dealt again and new dates still come', () => {
  const [gone] = idsOn(first, '2026-11-05').slice(3);
  const run = again(without(gone ?? ''), { through: '2026-12-15' });
  const day = daysOf(run)['2026-11-05'];
  const november = docsOf(run).find((d) => d.month === '2026-11');

  assert.deepEqual(day, { ids: idsOn(first, '2026-11-05'), available: false, missing: [gone] });
  assert.ok(november && !decodeTables(november, DAILY_FORMAT).pitches.some((p) => day?.ids.includes(p.id)));
  assert.equal(Object.keys(daysOf(run)).length, 45);
  assert.equal(new Set(Object.values(daysOf(run)).flatMap((d) => d.ids)).size, 450);
  assert.match(run.log.join('\n'), /unavailable 2026-11-05/);
});

test('a served pitch that stops being dealable makes its day unavailable too', () => {
  const [gone] = idsOn(first, '2026-11-02');
  const run = again(rebuilt((ps) => ps.map((p) => (idOf(p) === gone ? { ...p, dealable: false } : p))));

  assert.deepEqual(daysOf(run)['2026-11-02'], { ids: idsOn(first, '2026-11-02'), available: false, missing: [gone] });
});

test('a future day that loses a pitch is dealt again from the rest of the reserve, and no other day changes', () => {
  const lost = idsOn(first, '2026-11-20')[5] ?? '';
  const run = again(without(lost));
  const before = daysOf(first);
  const after = daysOf(run);
  const others = new Set(Object.entries(after).flatMap(([date, d]) => (date === '2026-11-20' ? [] : d.ids)));

  assert.notDeepEqual(after['2026-11-20']?.ids, before['2026-11-20']?.ids);
  assert.ok(!after['2026-11-20']?.ids.includes(lost));
  assert.ok(after['2026-11-20']?.ids.every((id) => !others.has(id)));
  assert.deepEqual({ ...after, '2026-11-20': null }, { ...before, '2026-11-20': null });
  assert.match(run.log.join('\n'), /re-dealt 2026-11-20/);
});

test('servedThrough defaults to the day after today, and never moves backwards', () => {
  const later = daily(season, { from: '2026-11-01', through: '2026-11-30', servedThrough: '2026-11-20' });

  assert.equal(first.daily.servedThrough, '2026-11-14');
  assert.equal(again(season, { servedThrough: '2026-11-10' }, later).daily.servedThrough, '2026-11-20');
  assert.equal(again(season, {}, later).daily.servedThrough, '2026-11-20');
  assert.equal(again(season, { check: true }, later).daily.servedThrough, '2026-11-20');
  assert.equal(again(season, { servedThrough: '2026-11-25' }, later).daily.servedThrough, '2026-11-25');
});

test('a served day whose close call drifts past 1.5 in stays as it was, and the drift is reported; a future one is re-dealt', () => {
  const s = readSeason(JSON.parse(season.manifestText), season.shardTexts);
  const closeCallOn = (date: string): string => idsOn(first, date).find((id) => (s.pitches.get(id)?.absMarginIn ?? 9) <= 1.5) ?? '';
  const served = closeCallOn('2026-11-03');
  const future = closeCallOn('2026-11-25');
  const run = again(rebuilt((ps) => ps.map((p) => ([served, future].includes(idOf(p)) ? { ...p, marginIn: 2 } : p))));

  assert.deepEqual(daysOf(run)['2026-11-03'], daysOf(first)['2026-11-03']);
  assert.match(run.log.join('\n'), /drift on served day 2026-11-03.*7 close calls/);
  assert.notDeepEqual(idsOn(run, '2026-11-25'), idsOn(first, '2026-11-25'));
});

test('over 400 days, as the reserve runs down, no ID repeats, every day keeps the rules, and a re-run is byte-identical', () => {
  const big = poolFor(400);
  const s = synthSeason(big.games, big.pitches);
  const run = daily(s, { from: '2026-11-01', through: '2027-12-05' });
  const known = readSeason(JSON.parse(s.manifestText), s.shardTexts);
  const days = Object.values(daysOf(run));

  assert.equal(days.length, 400);
  assert.equal(new Set(days.flatMap((d) => d.ids)).size, 4000);
  for (const d of days) {
    const cards = d.ids.flatMap((id) => known.pitches.get(id) ?? []);

    assert.deepEqual([...tenProblems(cards), ...varietyProblems(cards)], []);
  }
  assert.deepEqual([...daily(s, {}, monthsOf(run), withDaily(s, run)).files], [...run.files]);
});

test('the nine come in played order across shards: date, then start, then gamePk', () => {
  // A doubleheader on 2 May: its early game has the higher gamePk and sits in the second shard, so neither gamePk nor
  // shard order would put it first. The calibrator, from the last date, still leads.
  const games: SynthGame[] = [
    { gamePk: 930_001, date: '2026-05-01', start: '2026-05-01T23:05:00Z' },
    { gamePk: 930_050, date: '2026-05-02', start: '2026-05-02T17:05:00Z' },
    { gamePk: 930_040, date: '2026-05-02', start: '2026-05-02T23:10:00Z' },
    ...[3, 4, 5, 6, 7, 8, 9].map((d): SynthGame => ({ gamePk: 930_000 + d, date: `2026-05-0${d}`, start: `2026-05-0${d}T19:05:00Z` })),
  ];
  const at = (gamePk: number) => atBatFor(gamePk);
  const ten: SynthPitch[] = [
    { gamePk: 930_009, atBat: at(930_009), marginIn: 8, shard: 0 },
    { gamePk: 930_001, atBat: at(930_001), marginIn: 0.4, bats: 'L', type: 'SL', shard: 1 },
    { gamePk: 930_050, atBat: at(930_050), marginIn: -0.2, bats: 'L', shard: 1 },
    { gamePk: 930_040, atBat: at(930_040), marginIn: 0.9, type: 'CH', shard: 0 },
    { gamePk: 930_003, atBat: at(930_003), marginIn: -1.1, bats: 'L', shard: 0 },
    { gamePk: 930_004, atBat: at(930_004), marginIn: 0.6, strikes: 2, shard: 1 },
    { gamePk: 930_005, atBat: at(930_005), marginIn: -0.7, bats: 'L', challenged: true, shard: 0 },
    { gamePk: 930_006, atBat: at(930_006), marginIn: 1.2, type: 'SL', shard: 1 },
    { gamePk: 930_007, atBat: at(930_007), marginIn: -0.1, shard: 0 },
    { gamePk: 930_008, atBat: at(930_008), marginIn: 3, shard: 1 },
  ];
  const s = synthSeason(games, [...ten].reverse());
  const run = daily(s, { from: '2026-11-01', through: '2026-11-01' });

  assert.deepEqual(idsOn(run, '2026-11-01'), ten.map(idOf));
});

test('the manifest lists every month file with its size and hash, and the build its rows came from', () => {
  const manifest = JSON.parse(manifestOf(first)) as { build: string; daily: typeof first.daily };

  assert.deepEqual(
    manifest.daily.files.map((f) => f.file),
    ['daily/2026-11.json', 'daily/2026-12.json'],
  );
  for (const f of manifest.daily.files) {
    const text = monthsOf(first).get(f.file) ?? '';

    assert.equal(f.bytes, Buffer.byteLength(text));
    assert.equal((JSON.parse(text) as DailyDoc).build, manifest.build);
  }
  assert.deepEqual([manifest.daily.first, manifest.daily.last], ['2026-11-01', '2026-12-10']);
  assert.equal(manifest.daily.reserve.pitches, pool.pitches.filter((p) => p.dealable !== false && isDailyReserve(idOf(p))).length);
  assert.equal(JSON.parse(first.files.get(DAILY_REPORT_PATH) ?? '{}').freshRun.throughLast.sameAsSchedule, true);
  assert.ok(first.files.has(`${OUT_DIR}/manifest.json`));
});

test('the first run needs --from and --through, the start never moves, the schedule never shrinks, and a broken lock is refused', () => {
  const months = monthsOf(first);
  const november = months.get('daily/2026-11.json') ?? '';
  const twice = november.replace(idsOn(first, '2026-11-02')[0] ?? '', idsOn(first, '2026-11-01')[0] ?? '');

  assert.throws(() => daily(season, { through: '2026-12-01' }), /needs --from/);
  assert.throws(() => daily(season, { from: '2026-11-01' }), /needs --through/);
  assert.throws(() => again(season, { from: '2026-10-01' }), /starts on 2026-11-01/);
  assert.throws(() => again(season, { through: '2026-12-09' }), /runs to 2026-12-10 and never shrinks/);
  assert.equal(again(season, { through: '2026-12-10' }).daily.last, '2026-12-10');
  assert.throws(() => daily(season, {}, new Map([...months, ['daily/2027-01.json', '{}']]), withDaily(season, first)), /doesn't list daily\/2027-01.json/);
  assert.throws(() => daily(season, {}, new Map([['daily/2026-12.json', months.get('daily/2026-12.json') ?? '']]), withDaily(season, first)), /2026-11.json is listed in the manifest but missing/);
  assert.throws(() => daily(season, {}, new Map([...months, ['daily/2026-11.json', twice]]), withDaily(season, first)), /scheduled on both/);
});

test('data:daily prints a bad argument as its message alone, without a stack trace', () => {
  // --check, so the CLI would write nothing to the real dataset even if the argument got through.
  const cli = fileURLToPath(new URL('../daily.ts', import.meta.url));
  const run = spawnSync(process.execPath, [cli, '--check', '--through', 'not-a-date'], { encoding: 'utf8', timeout: 60_000 });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /^not-a-date isn't a date, YYYY-MM-DD$/m);
  assert.doesNotMatch(run.stderr, /^\s+at /m);
});

test("a file that isn't JSON, or isn't there, is a plain Error that names it, which data:daily prints as one line", () => {
  const months = new Map([...monthsOf(first), ['daily/2026-11.json', 'not JSON']]);
  const plain = (fn: () => unknown, pattern: RegExp): void => {
    assert.throws(fn, (e: unknown) => e instanceof Error && e.constructor === Error && pattern.test(e.message));
  };

  plain(() => daily(season, {}, months, withDaily(season, first)), /^daily\/2026-11\.json isn't JSON$/);
  plain(() => daily(season, {}, monthsOf(first), 'not JSON'), /^manifest\.json isn't JSON$/);
  plain(() => generateDaily(season.manifestText, new Map([...season.shardTexts].map(([file]) => [file, '{'])), new Map(), { today: '2026-11-13', from: '2026-11-01', through: '2026-11-02' }), /^shards\/\S+ isn't JSON$/);
  plain(() => readText(fileURLToPath(new URL('.', import.meta.url)), 'no-such-file.json'), /^no-such-file\.json is missing$/);
});
