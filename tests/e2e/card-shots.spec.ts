import { test } from '@playwright/test';
import { CARD_SOURCES, expectCardBackFits } from './card-fit';

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const [source, query] of CARD_SOURCES) {
      test(`no text on ${source}'s card back runs past its edge`, async ({ page }) => {
        await expectCardBackFits(page, query);
      });
    }
  });
}
