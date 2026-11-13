import { dateKeyOf } from '../core/daily.ts';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A real calendar date written YYYY-MM-DD, the only kind ?date= takes: "2026-02-30" isn't one. */
export function isDateKey(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);

  return m !== null && dateKeyOf(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) === s;
}

/** "May 14, 2026", from YYYY-MM-DD. */
export function dateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);

  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "November 2026", from YYYY-MM. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);

  return `${MONTHS[m - 1]} ${y}`;
}
