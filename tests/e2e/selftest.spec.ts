import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

// Once its verdict is in the title, the page times ten repaints of the static layers, each a stretch of main-thread
// work that holds off every read of the page, the title's included. On WebKit's 2x screen they took 2-5 s apiece, so the
// first read waited 50 s on a quiet machine and ran past its 60 s on a loaded one. No check depends on the pixel density,
// and at 1x a repaint takes about a second.
test.use({ deviceScaleFactor: 1 });

test('the self-test page passes', async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  const errors = trackErrors(page);
  const report = page.locator('#selftest');

  await page.goto('./?selftest=1', { waitUntil: 'domcontentloaded' });
  try {
    await expect.poll(() => page.title(), { timeout: 60_000 }).toMatch(/^SELFTEST /);
    expect(await page.title()).toBe('SELFTEST PASS');
    await expect(report).toContainText('RESULT: PASS');
    await expect(report).toContainText('[STANCE] static layers', { timeout: 90_000 });
  } finally {
    // Attached on failure too: the report names the checks that failed.
    const text = await report.textContent({ timeout: 5_000 }).catch(() => null);

    await testInfo.attach('selftest.txt', { body: text ?? '(no self-test output)', contentType: 'text/plain' });
  }
  await expect(page.locator('#err')).toBeHidden();
  expect(errors).toEqual([]);
});
