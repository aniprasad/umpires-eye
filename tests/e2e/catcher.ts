import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { fromPoolFile, type PoolFile } from '../../src/data/ws2026';
import { catcherRig } from '../../src/math/catcher';
import { playPoints } from '../../src/math/deal';
import { dofBlur } from '../../src/math/dof';
import { prep } from '../../src/math/kinematics';
import { createLens } from '../../src/math/lens';
import { eyeOf } from '../../src/math/stance';
import { seedRandom, waitReady } from './helpers';

// Pitch 8 of Today's Ten (a right-hander) frozen in the windup: the catcher's helmet rises out of the bottom edge on the
// side away from the batter. Its top edge is the scene's strongest defocused edge, against the lit infield.
const PITCH = 8;

export const QUERY = `state=pitch&i=${PITCH}&t=-0.6`;
// Rows of the strip at the top and bottom that set the infield and helmet levels.
const LEVEL_ROWS = 0.12;
// Must match the project's name in playwright.config.ts.
const REFERENCE_PROJECT = 'native-reference';

export interface Strip {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The lens blur at the helmet, CSS px. */
  sigma: number;
}

export interface Edge {
  dpr: number;
  filter: string;
  /** Luminance per row of canvas pixels, averaged across the strip. */
  profile: number[];
  /** Mean luminance of the infield above the edge and of the helmet below it. */
  field: number;
  helmet: number;
  /** 25-75% rise of the edge, CSS px. */
  spread: number;
}

/** The catcher's helmet edge and the frame foot as one page draws them. */
export interface CatcherShot {
  strip: Strip;
  edge: Edge;
  foot: number[][];
}

const pool = JSON.parse(readFileSync(new URL('../../public/data/ws-2026/pool.json', import.meta.url), 'utf8')) as PoolFile;
const data = fromPoolFile(pool);
const lens = createLens(playPoints(data.today, data.pitches));

/** A 40 px column strip across the top edge of the catcher's helmet, from the same math the renderer uses. */
export function helmetStrip(W: number, H: number): Strip {
  const P = prep(data.today[PITCH - 1]);
  const cam = lens.camFor(W, H, P);
  const m = catcherRig(P.batter.side, eyeOf(P));
  const q = cam.p(m.head);
  const top = q.y - m.r * q.k;
  const sigma = Math.max(2, dofBlur(cam, q.d));

  return { x0: Math.round(q.x - 20), x1: Math.round(q.x + 20), y0: Math.round(top - 3 * sigma), y1: Math.min(H, Math.round(top + 3 * sigma)), sigma };
}

export async function open(page: Page, query: string): Promise<void> {
  await seedRandom(page);
  await page.goto(`./?${query}`);
  await waitReady(page);
}

export async function measureEdge(page: Page, s: Strip): Promise<Edge> {
  const { dpr, filter, profile } = await page.evaluate((s) => {
    const c = document.getElementById('scene') as HTMLCanvasElement;
    const dpr = c.width / innerWidth;
    const x0 = Math.round(s.x0 * dpr);
    const y0 = Math.round(s.y0 * dpr);
    const img = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(x0, y0, Math.round(s.x1 * dpr) - x0, Math.round(s.y1 * dpr) - y0);
    const rows: number[] = [];

    for (let y = 0; y < img.height; y++) {
      let sum = 0;

      for (let x = 0; x < img.width; x++) {
        const i = 4 * (y * img.width + x);

        sum += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      }
      rows.push(sum / img.width);
    }

    return { dpr, filter: document.documentElement.dataset.canvasFilter ?? '', profile: rows };
  }, s);
  const n = Math.max(1, Math.round(profile.length * LEVEL_ROWS));
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const field = mean(profile.slice(0, n));
  const helmet = mean(profile.slice(-n));
  const below = (f: number): number => profile.findIndex((v) => v < field - f * (field - helmet));

  return { dpr, filter, profile, field, helmet, spread: (below(0.75) - below(0.25)) / dpr };
}

/**
 * Mean colour per row of the strip's columns over the bottom 3 sigma of the frame. The helmet runs off the bottom
 * edge there, and a blur that ignores what's drawn past the edge lets the infield show through it.
 */
export async function frameFoot(page: Page, s: Strip): Promise<number[][]> {
  return page.evaluate((s) => {
    const c = document.getElementById('scene') as HTMLCanvasElement;
    const dpr = c.width / innerWidth;
    const x0 = Math.round(s.x0 * dpr);
    const y0 = Math.round((innerHeight - 3 * s.sigma) * dpr);
    const img = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(x0, y0, Math.round(s.x1 * dpr) - x0, c.height - y0);
    const rows: number[][] = [];

    for (let y = 0; y < img.height; y++) {
      const sum = [0, 0, 0];

      for (let x = 0; x < img.width; x++) {
        for (let k = 0; k < 3; k++) sum[k] += img.data[4 * (y * img.width + x) + k];
      }
      rows.push(sum.map((v) => v / img.width));
    }

    return rows;
  }, s);
}

/** Opens the catcher's frame at the page's size and measures its helmet edge and frame foot. */
export async function shootCatcher(page: Page): Promise<CatcherShot> {
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const strip = helmetStrip(size.width, size.height);

  await open(page, QUERY);

  return { strip, edge: await measureEdge(page, strip), foot: await frameFoot(page, strip) };
}

/** A page is held to the reference drawn at its own size and density. */
export async function referenceKey(page: Page): Promise<string> {
  const size = page.viewportSize();
  const dpr = await page.evaluate(() => devicePixelRatio);

  return `${size?.width}x${size?.height}@${dpr}`;
}

/** The build of the app a page runs: its entry script, whose hashed name changes with the code and the assets it imports. */
export async function servedBuild(page: Page): Promise<string> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => new URL(s.src).pathname).join(' '));
}

/** What the native-reference project writes: the build it drew, and a drawing per size and density. */
export interface References {
  build: string;
  shots: Record<string, CatcherShot>;
}

function referenceFile(testInfo: TestInfo): string {
  const project = testInfo.config.projects.find((p) => p.name === REFERENCE_PROJECT);

  if (!project) throw new Error(`playwright.config.ts has no "${REFERENCE_PROJECT}" project to draw the native reference.`);

  return join(project.outputDir, `${REFERENCE_PROJECT}.json`);
}

export function writeReferences(testInfo: TestInfo, refs: References): void {
  const file = referenceFile(testInfo);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(refs));
}

/**
 * Edge's native drawing at the page's size and density, by the build the page runs. A command-line run clears the
 * output folder before it starts, but UI mode and the VS Code extension keep it, and run native-reference only when it's
 * ticked, so a reference left by an earlier build is refused.
 */
export function readReference(testInfo: TestInfo, key: string, build: string): CatcherShot {
  const file = referenceFile(testInfo);
  const redraw = `The ${REFERENCE_PROJECT} project draws it at the start of a run: don't skip it with --no-deps, and in UI mode or the VS Code extension, tick it too.`;
  let refs: References;

  try {
    refs = JSON.parse(readFileSync(file, 'utf8')) as References;
  } catch (e) {
    throw new Error(`No native reference in ${file}. ${redraw} (${String(e)})`);
  }
  if (refs.build !== build) throw new Error(`The native reference in ${file} is from another build of the app (${String(refs.build)}, not ${build}). ${redraw}`);
  const shot = refs.shots[key];

  if (!shot) throw new Error(`The native reference has no ${key}, only ${Object.keys(refs.shots).join(', ')}.`);

  return shot;
}
