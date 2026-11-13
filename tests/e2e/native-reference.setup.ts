import { expect, test } from '@playwright/test';
import { referenceKey, servedBuild, shootCatcher, writeReferences, type CatcherShot } from './catcher';
import { trackErrors } from './helpers';

// The catcher test holds every engine to Edge's native canvas filter at the page's size and density. Launched from
// inside that test, the reference Edge was a second browser in a WebKit worker drawing at 2x, and it stalled there
// reading its canvas back, launching or closing. This project draws the reference once per run in Edge's own worker,
// before the desktop projects that depend on it start.
test('Edge draws the native reference the catcher test compares against', async ({ browser, baseURL }, testInfo) => {
  const shots: Record<string, CatcherShot> = {};
  let build = '';

  for (const project of testInfo.config.projects.filter((p) => p.dependencies.includes(testInfo.project.name))) {
    const { viewport, deviceScaleFactor } = project.use;

    if (!viewport) throw new Error(`${project.name} sets no viewport to draw the reference at.`);
    const context = await browser.newContext({ baseURL, viewport, deviceScaleFactor });

    try {
      const page = await context.newPage();
      const errors = trackErrors(page);
      const key = await referenceKey(page);

      shots[key] = await shootCatcher(page);
      build = await servedBuild(page);
      expect(shots[key].edge.filter, `${project.name} at ${key}`).toBe('native');
      expect(errors, `${project.name} at ${key}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
  // without a build to name, a reference from any other build would pass for this one's
  expect(build, 'the entry script the reference was drawn by').not.toBe('');
  writeReferences(testInfo, { build, shots });
});
