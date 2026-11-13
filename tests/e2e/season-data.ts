// The synthetic season, served in place of the real one, and what the page asked of it.
import type { Page } from '@playwright/test';
import { SHARD_FORMAT } from '../../src/core/schema.ts';
import { seasonMini, type SeasonMini } from '../fixtures/season-mini';

export const mini = seasonMini();
export const DATA = '/data/season-2026/';
// More page time than the idle callback, or Safari's 2 s stand-in for it, waits before the prefetch (§4.1).
export const PAST_IDLE_MS = 5_000;

/** Serves a synthetic season in place of the real one, and records every data request, ?v= included. */
export async function serveSeason(page: Page, season: SeasonMini = mini): Promise<string[]> {
  const asked: string[] = [];

  await page.route((url) => url.pathname.includes(DATA), (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(url.pathname.indexOf(DATA) + DATA.length);
    const body = season.files.get(path);

    asked.push(path + url.search);

    return body === undefined ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }) : route.fulfill({ json: body });
  });

  return asked;
}

export const shards = (asked: readonly string[]): string[] => asked.filter((path) => path.startsWith('shards/'));

/** A data request, with the page's data-ready and #app's data-phase when it was made. */
export interface Load {
  readonly path: string;
  readonly ready: string;
  readonly phase: string;
}

/** Records in the page each data request with the app's state at the time, and #app's phase at each parse of a shard. */
export async function watchLoads(page: Page): Promise<void> {
  await page.addInitScript(({ data, shard }) => {
    const phase = (): string => document.getElementById('app')?.dataset.phase ?? '';
    const loads: Load[] = [];
    const parses: string[] = [];
    const fetchPage = window.fetch.bind(window);
    const parse = JSON.parse.bind(JSON);

    Object.assign(window, { ueLoads: loads, ueShardParses: parses });
    window.fetch = (input, init) => {
      const { pathname, search } = new URL(input instanceof Request ? input.url : String(input), location.href);
      const at = pathname.indexOf(data);

      if (at >= 0) loads.push({ path: pathname.slice(at + data.length) + search, ready: document.documentElement.dataset.ready ?? '', phase: phase() });

      return fetchPage(input, init);
    };
    JSON.parse = (text, reviver) => {
      if (typeof text === 'string' && text.includes(shard)) parses.push(phase());

      return parse(text, reviver) as unknown;
    };
  }, { data: DATA, shard: SHARD_FORMAT });
}

export const loadsOf = (page: Page): Promise<Load[]> => page.evaluate(() => (window as unknown as { ueLoads: Load[] }).ueLoads);
export const parsesOf = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { ueShardParses: string[] }).ueShardParses);

/** The device asks for less data, as Chromium reports it. Safari has no navigator.connection, so the init script adds one. */
export async function saveData(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  });
}
