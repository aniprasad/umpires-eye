import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';
import { mini, serveSeason } from './season-data';

export const CARD_SOURCES = [['the season', `date=${mini.date}`], ['the World Series', 'pool=ws']] as const;

// The longest pitch name with the longest location: two lines in the Toughest row, a line the foot no longer has.
const LONGEST_TOUGHEST = 'Four-Seam Fastball, low and away';

/**
 * Text on the card back that runs past its edges. The back's tilt comes off first: a transform doesn't move layout, so
 * the box and the lines of text then compare like for like. With `longest`, the Toughest row first takes the longest
 * value the card can show, styled as the app styles a long one.
 */
async function overflow(page: Page, longest: boolean): Promise<string[]> {
  return page.evaluate((tough) => {
    const back = document.querySelector<HTMLElement>('.ucard-back');

    if (!back) return ['no card back'];
    const row = document.querySelector<HTMLElement>('#ubTough');

    if (tough && row) {
      row.textContent = tough;
      row.classList.toggle('long', tough.length > 14);
    }
    for (let el: HTMLElement | null = back; el; el = el.parentElement) {
      el.style.animation = 'none';
      el.style.transform = 'none';
    }
    const edge = back.getBoundingClientRect();
    const out: string[] = [];
    const walker = document.createTreeWalker(back, NodeFilter.SHOW_TEXT);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';

      if (!text) continue;
      const range = document.createRange();

      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.left < edge.left - 0.5 || r.right > edge.right + 0.5 || r.top < edge.top - 0.5 || r.bottom > edge.bottom + 0.5) {
          out.push(`"${text.slice(0, 40)}": a line at (${Math.round(r.left - edge.left)}, ${Math.round(r.top - edge.top)})-(${Math.round(r.right - edge.left)}, ${Math.round(r.bottom - edge.top)}) on a ${Math.round(edge.width)}x${Math.round(edge.height)} back`);
        }
      }
    }

    return out;
  }, longest ? LONGEST_TOUGHEST : '');
}

/** Opens the source's card with its ump figure in, and expects every line of text on the back inside the back. */
export async function expectCardBackFits(page: Page, query: string): Promise<void> {
  const errors = trackErrors(page);

  if (query.startsWith('date=')) await serveSeason(page);
  await page.goto(`./?${query}&state=card&correct=7`);
  await waitReady(page);
  await expect(page.locator('#ubFigRow')).toBeVisible();
  expect(await overflow(page, false), 'the card as dealt').toEqual([]);
  expect(await overflow(page, true), 'with the longest Toughest').toEqual([]);
  expect(errors).toEqual([]);
}
