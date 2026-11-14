// npm run data:daily -- [--from YYYY-MM-DD] [--through YYYY-MM-DD] [--served-through YYYY-MM-DD] [--check]
// Writes Today's Ten: public/data/season-2026/daily/YYYY-MM.json, the manifest's daily block and the daily report, from
// the shards and the month files already there, which it keeps as a history lock (docs/DATA.md). The first run
// needs --from and --through. servedThrough defaults to the day after today in UTC; pass a later date if the commit won't
// go live by then. --check writes nothing: it reproduces the recorded schedule and fails if any file differs.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ManifestDoc } from '../../src/core/schema.ts';
import { DAILY_DIR, generateDaily, type DailyRun } from './lib/daily.ts';
import { parseJson, readText } from './lib/files.ts';
import { OUT_DIR } from './lib/pipeline.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values: args } = parseArgs({
  options: {
    from: { type: 'string' },
    through: { type: 'string' },
    'served-through': { type: 'string' },
    check: { type: 'boolean', default: false },
  },
});
const read = (rel: string): string => readText(root, rel);
let run: DailyRun;

try {
  // read inside the try, so a missing or broken file is a line too
  const manifestText = read(`${OUT_DIR}/manifest.json`);
  const manifest = parseJson(manifestText, 'manifest.json') as ManifestDoc;
  const shardTexts = new Map(manifest.shards.map((s) => [s.file, read(`${OUT_DIR}/${s.file}`)]));
  const dailyDir = join(root, OUT_DIR, DAILY_DIR);
  const monthTexts = new Map(
    (existsSync(dailyDir) ? readdirSync(dailyDir) : []).map((name) => [`${DAILY_DIR}/${name}`, read(`${OUT_DIR}/${DAILY_DIR}/${name}`)]),
  );

  run = generateDaily(manifestText, shardTexts, monthTexts, {
    ...(args.from === undefined ? {} : { from: args.from }),
    ...(args.through === undefined ? {} : { through: args.through }),
    ...(args['served-through'] === undefined ? {} : { servedThrough: args['served-through'] }),
    today: new Date().toISOString().slice(0, 10),
    check: args.check,
  });
} catch (e) {
  // A bad argument or a broken history is a plain Error whose message says it all. Anything else is a bug, so it keeps
  // its stack.
  if (!(e instanceof Error) || e.constructor !== Error) throw e;
  console.error(e.message);
  process.exit(1);
}

if (args.check) {
  const differ = [...run.files].filter(([rel, text]) => !existsSync(join(root, rel)) || read(rel) !== text).map(([rel]) => rel);

  if (differ.length) {
    console.error(`These files differ from the recorded schedule's:\n  ${differ.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`check: ${run.files.size} files reproduce byte for byte (served through ${run.daily.servedThrough})`);
} else {
  for (const [rel, text] of run.files) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  console.log(run.log.map((line) => `  ${line}`).join('\n'));
  console.log(`wrote ${run.daily.files.length} month files, the manifest's daily block and the daily report`);
}
