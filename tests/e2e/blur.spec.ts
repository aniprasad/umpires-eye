import { expect, test } from '@playwright/test';
import { QUERY, frameFoot, helmetStrip, measureEdge, open, readReference, referenceKey, servedBuild, shootCatcher } from './catcher';
import { trackErrors } from './helpers';

// Levels any row of the frame foot may drift from Edge native. Clipping the blur at the frame edge put the worst row
// 21-25 levels off, the infield showing through the helmet; blurring in what's past the edge brings it under 2.
const FOOT_GAP = 4;

const rms = (a: number[], b: number[]): number => Math.sqrt(a.reduce((m, v, i) => m + (v - b[i]) ** 2, 0) / a.length);

/** The largest gap between two row profiles, in any channel of any row. */
const worstRow = (a: number[][], b: number[][]): number => Math.max(...a.map((row, y) => Math.max(...row.map((v, k) => Math.abs(v - b[y][k])))));

test('the lens defocuses the catcher whichever way the engine draws it', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  const { strip: s, edge, foot } = await shootCatcher(page);
  // Edge with its native canvas filter at this page's size and density: the reference every engine is held to.
  const { edge: ref, foot: refFoot } = readReference(testInfo, await referenceKey(page), await servedBuild(page));
  const diff = rms(edge.profile, ref.profile);
  const footGap = worstRow(foot, refFoot);

  testInfo.annotations.push(
    { type: 'canvasFilter', description: edge.filter },
    { type: 'helmet edge', description: `25-75% rise ${edge.spread.toFixed(1)} px for a lens blur of ${s.sigma.toFixed(1)} px (Edge native ${ref.spread.toFixed(1)} px); infield ${edge.field.toFixed(1)} and helmet ${edge.helmet.toFixed(1)} levels (Edge native ${ref.field.toFixed(1)} and ${ref.helmet.toFixed(1)}); profile RMS against Edge ${diff.toFixed(2)} levels` },
    { type: 'frame foot', description: `helmet where it runs off the bottom: worst row ${footGap.toFixed(1)} levels from Edge native` },
  );
  expect(['native', 'fallback']).toContain(edge.filter);
  // a Gaussian of sigma s rises 25-75% over 1.35 s; an unblurred edge would rise in a pixel or two
  expect(edge.spread).toBeGreaterThan(0.8 * s.sigma);
  expect(edge.spread).toBeLessThan(2 * s.sigma);
  expect(diff).toBeLessThan(3);
  expect(footGap).toBeLessThan(FOOT_GAP);
  expect(errors).toEqual([]);
});

test('the forced fallback blur matches the native canvas filter', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'Only Chromium has the native filter to compare against.');
  const size = page.viewportSize() ?? { width: 1440, height: 900 };
  const s = helmetStrip(size.width, size.height);

  await open(page, QUERY);
  const native = await measureEdge(page, s);
  const nativeFoot = await frameFoot(page, s);

  await open(page, `${QUERY}&canvasFilter=fallback`);
  const fallback = await measureEdge(page, s);
  const footGap = worstRow(await frameFoot(page, s), nativeFoot);
  const diff = rms(fallback.profile, native.profile);
  const frame = await page.evaluate(() => {
    const c = document.getElementById('scene') as HTMLCanvasElement;

    return { w: c.width, h: c.height };
  });

  testInfo.annotations.push({ type: 'fallback vs native', description: `rise ${fallback.spread.toFixed(1)} vs ${native.spread.toFixed(1)} px; profile RMS ${diff.toFixed(2)} levels at ${frame.w}x${frame.h}; frame foot worst row ${footGap.toFixed(1)} levels` });
  expect(native.filter).toBe('native');
  expect(fallback.filter).toBe('fallback');
  expect(Math.abs(fallback.spread - native.spread)).toBeLessThan(0.2 * native.spread);
  expect(diff).toBeLessThan(2);
  expect(footGap).toBeLessThan(FOOT_GAP);
});
