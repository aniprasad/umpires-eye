/** The URL switches the tests and screenshots use: ?state=pitch|reveal|card with ?i, ?t, ?call, ?correct, and ?selftest=1. */
export const Q = new URLSearchParams(location.search);
export const STATE = Q.get('state');
export const SELFTEST = Q.get('selftest') === '1';
export const REDUCED = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
