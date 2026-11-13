// Builds the shipped assets from the mockup's masters: web-sized WebP images, the fonts and their licences, and the
// 2026 World Series pitch pool. The masters stay in mockup/ (batter-src.png is source art and never ships).
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const masters = join(root, 'mockup', 'assets');
const out = {
  img: join(root, 'src', 'assets', 'img'),
  fonts: join(root, 'src', 'assets', 'fonts'),
  licences: join(root, 'public', 'fonts'),
  data: join(root, 'public', 'data', 'ws-2026'),
};

// The backdrop and batter keep their full resolution: the renderer's art metrics (wall row, cleats, helmet top) are
// in image pixels. The card art is shown about 286 px wide, so 600w covers DPR 2 and 1024w covers DPR 3.
const IMAGES = [
  { from: 'backdrop-wide.png', to: 'backdrop-wide.webp', webp: { quality: 80, smartSubsample: true } },
  { from: 'backdrop.png', to: 'backdrop.webp', webp: { quality: 75, smartSubsample: true } },
  { from: 'batter.png', to: 'batter.webp', webp: { quality: 85, alphaQuality: 90 } },
  { from: 'card-art.png', to: 'card-art-1024.webp', width: 1024, webp: { quality: 80 } },
  { from: 'card-art.png', to: 'card-art-600.webp', width: 600, webp: { quality: 80 } },
];
const FONTS = ['big-shoulders-display-latin.woff2', 'courier-prime-400-latin.woff2', 'courier-prime-700-latin.woff2'];
const LICENCES = ['OFL-BigShouldersDisplay.txt', 'OFL-CourierPrime.txt'];

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const rows = [];

for (const dir of Object.values(out)) await mkdir(dir, { recursive: true });

for (const im of IMAGES) {
  const src = join(masters, im.from);
  const dst = join(out.img, im.to);
  let pipe = sharp(src);

  if (im.width) pipe = pipe.resize({ width: im.width });
  const info = await pipe.webp({ effort: 6, ...im.webp }).toFile(dst);

  rows.push([relative(root, dst), `${info.width}x${info.height}`, kb((await stat(src)).size), kb(info.size)]);
}

for (const f of FONTS) {
  const dst = join(out.fonts, f);

  await copyFile(join(masters, 'fonts', f), dst);
  const size = (await stat(dst)).size;

  rows.push([relative(root, dst), 'font', kb(size), kb(size)]);
}
for (const f of LICENCES) await copyFile(join(masters, 'fonts', f), join(out.licences, f));

const poolSrc = join(root, 'mockup', 'data', 'pool.json');
const poolDst = join(out.data, 'pool.json');
const pool = JSON.stringify(JSON.parse(await readFile(poolSrc, 'utf8')));

await writeFile(poolDst, pool);
rows.push([relative(root, poolDst), 'data', kb((await stat(poolSrc)).size), kb(Buffer.byteLength(pool))]);

const head = ['output', 'size', 'master', 'shipped'];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const fmt = (r) => r.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ');

console.log(fmt(head));
for (const r of rows) console.log(fmt(r));
