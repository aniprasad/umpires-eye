import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDailyReserve } from '../../../src/core/daily.ts';
import { checkDaily, type DailyFiles } from '../lib/daily-check.ts';
import { DAILY_REPORT_PATH } from '../lib/daily.ts';
import { daily, idOf, manifestOf, monthsOf, poolFor, synthSeason } from './daily-fixtures.ts';

const pool = poolFor(40);
const season = synthSeason(pool.games, pool.pitches);
const run = daily(season, { from: '2026-11-01', through: '2026-12-10' });
const files: DailyFiles = {
  manifestText: manifestOf(run),
  statsText: season.statsText,
  shardTexts: season.shardTexts,
  monthTexts: monthsOf(run),
  reportText: run.files.get(DAILY_REPORT_PATH) ?? null,
};
const NOVEMBER = 'daily/2026-11.json';
const november = files.monthTexts.get(NOVEMBER) ?? '';
const ids = (date: string): string[] => (JSON.parse(november) as { days: Record<string, { ids: string[] }> }).days[date]?.ids ?? [];
/** The files with November's month file edited. */
const withNovember = (edit: (text: string) => string): DailyFiles => ({ ...files, monthTexts: new Map([...files.monthTexts, [NOVEMBER, edit(november)]]) });
/** Edits one day's line in the days block. */
const onDay = (date: string, edit: (line: string) => string) => (text: string): string =>
  text.replace(new RegExp(`^"${date}":.*$`, 'm'), (line) => edit(line));
const fails = (f: DailyFiles, pattern: RegExp): void => {
  const { failures } = checkDaily(f);

  assert.ok(failures.some((m) => pattern.test(m)), `no failure matches ${pattern}:\n  ${failures.join('\n  ')}`);
};

test('a schedule as data:daily writes it passes, within the budgets', () => {
  const verdict = checkDaily(files);

  assert.deepEqual(verdict.failures, []);
  assert.deepEqual(verdict.notes, []);
  assert.deepEqual(Object.keys(verdict.monthGzipBytes), [NOVEMBER, 'daily/2026-12.json']);
  assert.ok(verdict.bootGzipBytes > 0 && verdict.sessionGzipBytes > verdict.bootGzipBytes);
});

test('an ID on two dates fails', () => {
  fails(withNovember(onDay('2026-11-02', (line) => line.replace(ids('2026-11-02')[0] ?? '', ids('2026-11-01')[0] ?? ''))), /scheduled on both 2026-11-01 and 2026-11-02/);
});

test('a row that differs from its shard fails', () => {
  fails(withNovember((text) => text.replace(/^(\[\d+,\d+,1,(?:[^,\n]*,){14})95,/m, '$196,')), /row differs from its shard's/);
});

test('an ID outside the reserve fails', () => {
  const outside = pool.pitches.map(idOf).find((id) => !isDailyReserve(id)) ?? '';

  fails(withNovember(onDay('2026-11-04', (line) => line.replace(ids('2026-11-04')[3] ?? '', outside))), new RegExp(`${outside} isn't in the daily reserve`));
});

test('a gap in the dates fails', () => {
  fails(withNovember((text) => text.replace(/^"2026-11-07":.*\n/m, '')), /no ten on 2026-11-07/);
});

test('an unavailable day after servedThrough fails', () => {
  const [gone] = ids('2026-11-20');

  fails(withNovember(onDay('2026-11-20', (line) => line.replace('"available":true}', `"available":false,"missing":["${gone}"]}`))), /2026-11-20: unavailable, but after servedThrough/);
});

test('a month file from another build fails', () => {
  fails(withNovember((text) => text.replace(`"build":"${season.build}"`, '"build":"0123456789ab"')), /2026-11.json: build 0123456789ab is not the manifest's/);
});

test('rows out of the order data:daily writes them fail check mode', () => {
  const swapped = (text: string): string => {
    const lines = text.split('\n');
    const k = lines.indexOf('"pitches":[') + 1;

    [lines[k], lines[k + 1]] = [lines[k + 1] ?? '', lines[k] ?? ''];

    return lines.join('\n');
  };

  fails(withNovember(swapped), /2026-11.json isn't what npm run data:daily -- --check reproduces/);
});

test('a stale reserve count, a month file the manifest leaves out and a missing one all fail', () => {
  const manifest = JSON.parse(files.manifestText) as { daily: { reserve: { pitches: number } } };

  manifest.daily.reserve.pitches++;
  fails({ ...files, manifestText: `${JSON.stringify(manifest, null, 2)}\n` }, /the daily block's reserve/);
  fails({ ...files, monthTexts: new Map([...files.monthTexts, ['daily/2027-01.json', '{}']]) }, /daily\/2027-01.json is in the daily folder but not in the manifest/);
  fails({ ...files, monthTexts: new Map([[NOVEMBER, november]]) }, /daily\/2026-12.json is missing/);
});

test('a month file, the boot fetch or a session over its budget fails', () => {
  const verdict = checkDaily(files);
  const tight = { month: verdict.monthGzipBytes[NOVEMBER] ?? 0, boot: verdict.bootGzipBytes, session: verdict.sessionGzipBytes };

  assert.deepEqual(checkDaily(files, tight).failures, []);
  assert.match(checkDaily(files, { ...tight, month: tight.month - 1 }).failures.join('\n'), /2026-11.json: \d+ gzipped bytes, over the/);
  assert.match(checkDaily(files, { ...tight, boot: tight.boot - 1 }).failures.join('\n'), /the boot fetch is \d+ gzipped bytes/);
  assert.match(checkDaily(files, { ...tight, session: tight.session - 1 }).failures.join('\n'), /a session is \d+ gzipped bytes/);
});

test('a served day that no longer keeps the rules is reported, not failed', () => {
  // servedThrough moves past a day whose calibrator no longer comes first: as if the data changed after it was served.
  const [a, b] = ids('2026-11-20');
  const served = files.manifestText.replace('"servedThrough": "2026-11-14"', '"servedThrough": "2026-11-30"');
  const verdict = checkDaily({ ...withNovember(onDay('2026-11-20', (line) => line.replace(`"${a}","${b}"`, `"${b}","${a}"`))), manifestText: served });

  assert.ok(verdict.notes.some((n) => /2026-11-20: .*no calibrator first/.test(n)), verdict.notes.join('\n'));
  assert.ok(!verdict.failures.some((f) => /2026-11-20: .*no calibrator first/.test(f)));
});
