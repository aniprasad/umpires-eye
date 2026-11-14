import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { trackErrors } from './helpers';

// Once its verdict is in the title, the page times ten repaints of the static layers, each a stretch of main-thread
// work that holds off every read of the page, the title's included. On WebKit's 2x screen they took 2-5 s apiece, so the
// first read waited 50 s on a quiet machine and ran past its 60 s on a loaded one. No check depends on the pixel density,
// and at 1x a repaint takes about a second.
test.use({ deviceScaleFactor: 1 });

/** Opens a self-test page and expects it to pass on the source it names. */
async function expectPass(page: Page, testInfo: TestInfo, url: string, source: string): Promise<void> {
  const errors = trackErrors(page);
  const report = page.locator('#selftest');

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await expect.poll(() => page.title(), { timeout: 60_000 }).toMatch(/^SELFTEST /);
    expect(await page.title()).toBe('SELFTEST PASS');
    await expect(report).toContainText('RESULT: PASS');
    await expect(report).toContainText(`source: ${source}`);
    await expect(report).toContainText('[STANCE] static layers', { timeout: 90_000 });
  } finally {
    // Attached on failure too: the report names the checks that failed.
    const text = await report.textContent({ timeout: 5_000 }).catch(() => null);

    await testInfo.attach('selftest.txt', { body: text ?? '(no self-test output)', contentType: 'text/plain' });
  }
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
}

test('the self-test page passes', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await expectPass(page, testInfo, './?selftest=1', 'the World Series pool, with every check');
});

// On the shipped season files: the self-test checks the data the page plays, as the World Series' does.
test("the self-test page passes on the season's Today's Ten, which a ?pool= the app doesn't know plays", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await expectPass(page, testInfo, './?selftest=1&pool=nope&date=2026-11-14', "the 2026 season's Today's Ten for 2026-11-14");
});
