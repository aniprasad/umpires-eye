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

/**
 * Records in the page each data request with the app's state at the time, #app's phase each time a shard's text arrives,
 * and its phase at each parse of a shard.
 */
export async function watchLoads(page: Page): Promise<void> {
  await page.addInitScript(({ data, shard }) => {
    const phase = (): string => document.getElementById('app')?.dataset.phase ?? '';
    const loads: Load[] = [];
    const texts: string[] = [];
    const parses: string[] = [];
    const fetchPage = window.fetch.bind(window);
    const readText = Response.prototype.text;
    const parse = JSON.parse.bind(JSON);

    Object.assign(window, { ueLoads: loads, ueShardTexts: texts, ueShardParses: parses });
    window.fetch = (input, init) => {
      const { pathname, search } = new URL(input instanceof Request ? input.url : String(input), location.href);
      const at = pathname.indexOf(data);

      if (at >= 0) loads.push({ path: pathname.slice(at + data.length) + search, ready: document.documentElement.dataset.ready ?? '', phase: phase() });

      return fetchPage(input, init);
    };
    Response.prototype.text = async function text(this: Response): Promise<string> {
      const body = await readText.call(this);

      if (body.includes(shard)) texts.push(phase());

      return body;
    };
    JSON.parse = (text, reviver) => {
      if (typeof text === 'string' && text.includes(shard)) parses.push(phase());

      return parse(text, reviver) as unknown;
    };
  }, { data: DATA, shard: SHARD_FORMAT });
}

export const loadsOf = (page: Page): Promise<Load[]> => page.evaluate(() => (window as unknown as { ueLoads: Load[] }).ueLoads);
export const textsOf = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { ueShardTexts: string[] }).ueShardTexts);
export const parsesOf = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { ueShardParses: string[] }).ueShardParses);

/** The device asks for less data, as Chromium reports it. Safari has no navigator.connection, so the init script adds one. */
export async function saveData(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  });
}

/** Holds a data file's answers until the test lets them go. Routes run newest first, so this one sees them first. */
export async function hold(page: Page, file: string): Promise<() => void> {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route((url) => url.pathname.endsWith(DATA + file), async (route) => {
    await held;
    await route.fallback();
  });

  return release;
}

/**
 * Console and page errors, apart from the browser's reports of the one data file a test makes fail. Those are counted
 * instead, so the test can say how many there should be (AGENTS.md).
 */
export function errorsBut(page: Page, file: string): { errors: string[]; allowed: string[] } {
  const errors: string[] = [];
  const allowed: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const { url } = message.location();

    if (url && new URL(url).pathname.endsWith(DATA + file)) allowed.push(message.text());
    // browsers ask for /favicon.ico on their own, as trackErrors allows
    else if (!url.endsWith('/favicon.ico')) errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  return { errors, allowed };
}
