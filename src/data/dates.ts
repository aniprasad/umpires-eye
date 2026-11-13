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

/**
 * When the local date after `now`'s begins: at midnight, or where a clock change skips midnight, at the first moment the
 * date has (01:00 in Santiago on 2026-09-06). Its length from `now` isn't fixed, since a day can last 23 or 25 hours.
 */
export function nextDayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

/** "November 2026", from YYYY-MM. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);

  return `${MONTHS[m - 1]} ${y}`;
}
