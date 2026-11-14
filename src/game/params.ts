import { isDateKey } from '../data/dates';

/**
 * The URL switches the tests and screenshots use: ?state=pitch|reveal|card with ?i, ?t, ?call, ?correct, ?selftest=1,
 * ?pool=, which picks the pitches (data/sources.ts), ?date=, ?timing=1, which shows what the page paints and loads, and
 * ?work=1, which lets the speed test count the scene's static paints.
 */
export const Q = new URLSearchParams(location.search);
export const STATE = Q.get('state');
export const SELFTEST = Q.get('selftest') === '1';
export const TIMING = Q.get('timing') === '1';
export const WORK = Q.get('work') === '1';
export const POOL = Q.get('pool');
export const REDUCED = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const date = Q.get('date');

/** ?date=YYYY-MM-DD plays that date's Today's Ten rather than the local date's. Anything else is ignored. */
export const DATE = date !== null && isDateKey(date) ? date : null;
