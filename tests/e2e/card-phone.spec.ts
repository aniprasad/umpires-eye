import { test } from '@playwright/test';
import { CARD_SOURCES, expectCardBackFits } from './card-fit';

for (const [source, query] of CARD_SOURCES) {
  test(`no text on ${source}'s card back runs past its edge`, async ({ page }) => {
    await expectCardBackFits(page, query);
  });
}
