import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { Area, Box } from './helpers';
import { mockupUrl, nextFrames, seedRandom, slugOf, waitReady } from './helpers';

// Tune these after measuring. The largest share of the pixels outside the credit footnotes that may differ, per mode.
const MAX_MASKED_RATIO = { exact: 0.005, shipped: 0.03 } as const;
// A pixel differs when any of its RGB channels moves by more than this many levels out of 255.
const CHANNEL_TOLERANCE = 8;
// The port's longer data credit is deliberate, but it is taller, and the card (and the phone start screen) lay out
// around it. Giving the mockup's footnotes the port's footnote heights stops that from moving everything else.
const ALIGN_CREDIT = true;
const MODES = ['exact', 'shipped'] as const;
const VIEWPORTS: readonly Area[] = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
const STATES = [
  'state=start',
  'state=pitch&i=8&t=0.358',
  'state=pitch&i=6&t=0.563',
  'state=pitch&i=1&t=-0.6',
  'state=reveal&i=4&call=strike',
  'state=reveal&i=5&call=ball',
  'state=reveal&i=1&call=ball',
  'state=card&correct=8',
];
const CREDIT_SELECTORS = ['.footnote', '.cards-foot'];
// Anti-aliased glyphs can spill a pixel or two past their text box.
const MASK_PAD = 2;
const DIM = 0.3;
// Longest first, so that a backdrop-wide file is never taken for the plain backdrop.
const MASTERS = ['backdrop-wide', 'card-art', 'backdrop', 'batter'] as const;
const MASTER_DIR = new URL('../../mockup/assets/', import.meta.url);
const REPO = fileURLToPath(new URL('../../', import.meta.url));

type Mode = (typeof MODES)[number];

interface Row {
  mode: Mode;
  viewport: string;
  state: string;
  width: number;
  height: number;
  differing: number;
  ratio: number;
  maskedDiffering: number;
  maskedRatio: number;
  meanAbs: number;
  maskedMeanAbs: number;
  mask: Box[];
  limit: number;
  pass: boolean;
  files: { mockup: string; port: string; diff: string };
}

interface ModeRows {
  mode: Mode;
  routedMasters: number;
  rows: Row[];
}

interface Diff {
  width: number;
  height: number;
  differing: number;
  maskedDiffering: number;
  kept: number;
  sum: number;
  keptSum: number;
  image: Buffer;
}

const sizeOf = (area: Area): string => `${area.width}x${area.height}`;
const repoPath = (file: string): string => relative(REPO, file).split(sep).join('/');
const masterBytes = new Map<string, Buffer>();

function masterFor(url: URL): string | undefined {
  const file = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);

  if (!file.endsWith('.webp')) return undefined;
  const stem = file.slice(0, -'.webp'.length);

  return MASTERS.find((name) => stem === name || stem.startsWith(`${name}-`));
}

function masterPng(name: string): Buffer {
  const cached = masterBytes.get(name);

  if (cached) return cached;
  const bytes = readFileSync(new URL(`${name}.png`, MASTER_DIR));

  masterBytes.set(name, bytes);

  return bytes;
}

async function routeMasters(page: Page, routed: { count: number }): Promise<void> {
  await page.route((url) => masterFor(url) !== undefined, async (route) => {
    const name = masterFor(new URL(route.request().url()));

    if (!name) return route.continue();
    routed.count++;
    await route.fulfill({ body: masterPng(name), contentType: 'image/png' });
  });
}

async function creditBoxes(page: Page): Promise<Box[]> {
  return page.evaluate((selectors) => [...document.querySelectorAll(selectors.join(', '))]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.getBoundingClientRect())
    .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })), CREDIT_SELECTORS);
}

async function alignCredit(port: Page, mockup: Page): Promise<void> {
  const heights = await port.evaluate((selectors) => selectors.map((selector) => {
    const el = document.querySelector(selector);

    return el && el.getClientRects().length > 0 ? el.getBoundingClientRect().height : null;
  }), CREDIT_SELECTORS);

  await mockup.evaluate(({ selectors, sizes }) => {
    selectors.forEach((selector, k) => {
      const el = document.querySelector<HTMLElement>(selector);
      const size = sizes[k];

      if (!el || typeof size !== 'number') return;
      el.style.height = `${size}px`;
      el.style.overflow = 'hidden';
    });
  }, { selectors: CREDIT_SELECTORS, sizes: heights });
  await nextFrames(mockup);
}

function diffShots(mockShot: Buffer, portShot: Buffer, mask: Box[], cssWidth: number): Diff {
  const mock = PNG.sync.read(mockShot);
  const port = PNG.sync.read(portShot);

  if (mock.width !== port.width || mock.height !== port.height) {
    throw new Error(`The shots differ in size: ${mock.width}x${mock.height} and ${port.width}x${port.height}`);
  }

  const { width, height } = mock;
  const scale = width / cssWidth;
  const masked = new Uint8Array(width * height);
  const image = new PNG({ width, height });
  const a = mock.data;
  const b = port.data;
  const out = image.data;
  let differing = 0;
  let maskedDiffering = 0;
  let kept = 0;
  let sum = 0;
  let keptSum = 0;

  for (const box of mask) {
    const x0 = Math.max(0, Math.floor((box.x - MASK_PAD) * scale));
    const x1 = Math.min(width, Math.ceil((box.x + box.width + MASK_PAD) * scale));
    const y0 = Math.max(0, Math.floor((box.y - MASK_PAD) * scale));
    const y1 = Math.min(height, Math.ceil((box.y + box.height + MASK_PAD) * scale));

    for (let y = y0; x1 > x0 && y < y1; y++) masked.fill(1, y * width + x0, y * width + x1);
  }

  for (let p = 0; p < width * height; p++) {
    const i = 4 * p;
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const off = dr > CHANNEL_TOLERANCE || dg > CHANNEL_TOLERANCE || db > CHANNEL_TOLERANCE;
    const inMask = masked[p] === 1;

    sum += dr + dg + db;
    if (off) differing++;
    if (!inMask) {
      kept++;
      keptSum += dr + dg + db;
      if (off) maskedDiffering++;
    }
    if (off) {
      out[i] = 255;
      out[i + 1] = inMask ? 176 : 0;
      out[i + 2] = 0;
    } else {
      out[i] = Math.round(a[i] * DIM);
      out[i + 1] = Math.round(a[i + 1] * DIM);
      out[i + 2] = Math.round(a[i + 2] * DIM);
    }
    out[i + 3] = 255;
  }

  return { width, height, differing, maskedDiffering, kept, sum, keptSum, image: PNG.sync.write(image) };
}

async function compare(mode: Mode, area: Area, state: string, mockup: Page, port: Page, dir: string): Promise<Row> {
  await Promise.all([mockup.goto(mockupUrl(state)), port.goto(`./?${state}`)]);
  await Promise.all([waitReady(mockup), waitReady(port)]);
  if (ALIGN_CREDIT) await alignCredit(port, mockup);

  const mockShot = await mockup.screenshot({ animations: 'disabled' });
  const portShot = await port.screenshot({ animations: 'disabled' });
  const slug = slugOf(state);
  const files = { mockup: join(dir, `${slug}-mockup.png`), port: join(dir, `${slug}-port.png`), diff: join(dir, `${slug}-diff.png`) };

  writeFileSync(files.mockup, mockShot);
  writeFileSync(files.port, portShot);

  const mask = [...(await creditBoxes(mockup)), ...(await creditBoxes(port))];
  const diff = diffShots(mockShot, portShot, mask, area.width);
  const pixels = diff.width * diff.height;
  const maskedRatio = diff.kept > 0 ? diff.maskedDiffering / diff.kept : 0;
  const limit = MAX_MASKED_RATIO[mode];

  writeFileSync(files.diff, diff.image);

  return {
    mode,
    viewport: sizeOf(area),
    state,
    width: diff.width,
    height: diff.height,
    differing: diff.differing,
    ratio: diff.differing / pixels,
    maskedDiffering: diff.maskedDiffering,
    maskedRatio,
    meanAbs: diff.sum / (3 * pixels),
    maskedMeanAbs: diff.kept > 0 ? diff.keptSum / (3 * diff.kept) : 0,
    mask,
    limit,
    pass: maskedRatio <= limit,
    files: { mockup: repoPath(files.mockup), port: repoPath(files.port), diff: repoPath(files.diff) },
  };
}

function saveRows(out: string, part: ModeRows): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `rows-${part.mode}.json`), `${JSON.stringify(part, null, 2)}\n`);
}

function readRows(out: string, mode: Mode): ModeRows | undefined {
  const file = join(out, `rows-${mode}.json`);

  if (!existsSync(file)) return undefined;
  const part: unknown = JSON.parse(readFileSync(file, 'utf8'));

  return typeof part === 'object' && part !== null && 'rows' in part ? (part as ModeRows) : undefined;
}

function markdown(out: string, rows: Row[]): string {
  const pct = (ratio: number): string => (100 * ratio).toFixed(3);
  const lines = [
    '# Mockup and port pixel parity',
    '',
    `A pixel differs when any RGB channel moves by more than ${CHANNEL_TOLERANCE}/255. Masked leaves out the boxes of \`.footnote\` and \`.cards-foot\` on both pages${ALIGN_CREDIT ? '; before capture the mockup footnotes take the port footnote heights, so the longer credit does not move the rest of the screen' : ''}.`,
    `Exact routes the port's WebP images to the PNG masters in \`mockup/assets\`; shipped uses the built files. Limits on the masked share: exact ${pct(MAX_MASKED_RATIO.exact)} %, shipped ${pct(MAX_MASKED_RATIO.shipped)} %.`,
    '',
    `Shots: \`${repoPath(out)}/<mode>/<viewport>/<slug>-{mockup,port,diff}.png\`, where the slug is the state without \`state=\` and with \`&\` and \`=\` turned into \`-\`. In a diff, red marks a differing pixel and amber one inside the mask.`,
    '',
    '| Mode | Viewport | State | Differing px | Raw % | Masked % | Mean abs diff | Within limit |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...rows.map((r) => `| ${r.mode} | ${r.viewport} | \`${r.state}\` | ${r.differing} | ${pct(r.ratio)} | ${pct(r.maskedRatio)} | ${r.meanAbs.toFixed(2)} | ${r.pass ? 'yes' : 'no'} |`),
  ];

  return `${lines.join('\n')}\n`;
}

function writeReport(out: string): void {
  const parts = MODES.map((mode) => readRows(out, mode)).filter((part): part is ModeRows => part !== undefined);
  const rows = parts.flatMap((part) => part.rows);
  const report = {
    generatedAt: new Date().toISOString(),
    channelTolerance: CHANNEL_TOLERANCE,
    alignCredit: ALIGN_CREDIT,
    maxMaskedRatio: MAX_MASKED_RATIO,
    routedMasters: Object.fromEntries(parts.map((part): [Mode, number] => [part.mode, part.routedMasters])),
    rows,
  };

  writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, 'report.md'), markdown(out, rows));
}

// One test per mode, in order and in one worker: each saves its rows, and the report is rebuilt from all saved rows.
test.describe.configure({ mode: 'default' });
// The report and its shots are the record; traces of this many heavy page loads would only add hundreds of megabytes.
test.use({ trace: 'off' });

for (const mode of MODES) {
  test(`${mode}: the port's shots match the mockup's`, async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(15 * 60_000);

    const out = join(testInfo.project.outputDir, 'parity');
    const rows: Row[] = [];
    const routed = { count: 0 };

    try {
      for (const area of VIEWPORTS) {
        const dir = join(out, mode, sizeOf(area));
        const options = { viewport: area, deviceScaleFactor: 1 };
        // Two contexts open two windows, so a headed run keeps both pages in front, where animation frames still run.
        const mockupContext = await browser.newContext(options);
        const portContext = await browser.newContext({ ...options, baseURL });

        mkdirSync(dir, { recursive: true });
        try {
          const mockup = await mockupContext.newPage();
          const port = await portContext.newPage();

          await seedRandom(mockup);
          await seedRandom(port);
          if (mode === 'exact') await routeMasters(port, routed);
          for (const state of STATES) {
            await test.step(`${sizeOf(area)} ${state}`, async () => {
              const row = await compare(mode, area, state, mockup, port, dir);

              rows.push(row);
              expect.soft(row.maskedRatio, `${mode} ${row.viewport} ${state}: share of differing pixels outside the credit`).toBeLessThanOrEqual(row.limit);
            });
          }
        } finally {
          await Promise.all([mockupContext.close(), portContext.close()]);
        }
      }
      if (mode === 'exact') expect.soft(routed.count, "PNG masters served in place of the port's WebP images").toBeGreaterThan(0);
    } finally {
      saveRows(out, { mode, routedMasters: routed.count, rows });
      writeReport(out);
      await testInfo.attach('report.md', { path: join(out, 'report.md'), contentType: 'text/markdown' });
    }
  });
}
