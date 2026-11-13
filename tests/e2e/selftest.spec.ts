import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers';

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
