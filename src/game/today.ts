// Today's Ten keeps to the local date while the start screen shows it.
import { nextDayStart } from '../data/dates';
import type { TodayResult } from '../data/source';

export interface LatestToday {
  /**
   * The Ten for a date, or null once a later call has taken over: the earlier load is aborted, and its result dropped
   * even if it comes anyway. Rejects as the source's today() does.
   */
  load(dateKey: string): Promise<TodayResult | null>;
  /** Whether a load is running. */
  busy(): boolean;
}

/** Loads dates' Tens so that the latest call wins. */
export function latestToday(today: (dateKey: string, signal: AbortSignal) => Promise<TodayResult>): LatestToday {
  let current: AbortController | null = null;

  return {
    async load(dateKey) {
      current?.abort();
      const mine = new AbortController();

      current = mine;
      try {
        const result = await today(dateKey, mine.signal);

        return current === mine ? result : null;
      } catch (e) {
        if (current !== mine) return null;
        throw e;
      } finally {
        if (current === mine) current = null;
      }
    },
    busy: () => current !== null,
  };
}

/**
 * Calls `check` at each local midnight, and whenever the page comes back into view: a sleeping device or a background
 * tab can hold a timer well past midnight.
 */
export function watchMidnight(check: () => void): void {
  const arm = (): void => {
    const now = new Date();

    window.setTimeout(() => {
      check();
      arm();
    }, nextDayStart(now).getTime() - now.getTime());
  };

  arm();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) check();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) check();
  });
}
