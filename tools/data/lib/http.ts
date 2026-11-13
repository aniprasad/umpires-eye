export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  fetch?: FetchFn;
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (line: string) => void;
}

export interface Fetched {
  text: string;
  wireBytes: number | null;
}

export class HttpError extends Error {
  readonly status: number;

  constructor(url: string, status: number) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

export const USER_AGENT = "umpires-eye-data/1 (free, non-commercial fan project; builds the app's pitch dataset once)";

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const cause = err.cause as { code?: string; message?: string } | undefined;

  return cause ? `${err.message} (${cause.code ?? cause.message ?? 'no detail'})` : err.message;
}

function retryAfterMs(header: string | null, maxMs: number): number | null {
  if (!header) return null;

  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();

  return Number.isFinite(ms) ? Math.min(maxMs, Math.max(0, ms)) : null;
}

// The Stats API's DNS fails for a moment now and then, so network errors and 5xx are retried with exponential
// backoff and jitter. A 4xx other than a timeout or rate limit will not get better and fails at once.
export async function getText(url: string, opts: HttpOptions = {}): Promise<Fetched> {
  const f = opts.fetch ?? fetch;
  const attempts = opts.attempts ?? 8;
  const maxMs = opts.maxDelayMs ?? 60_000;
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? delay;
  const backoff = (attempt: number): number =>
    Math.min(maxMs, (opts.baseDelayMs ?? 1000) * 2 ** (attempt - 1)) * (0.75 + 0.5 * random());

  for (let attempt = 1; ; attempt++) {
    let wait: number;
    let why: string;

    try {
      const res = await f(url, {
        headers: { 'accept-encoding': 'gzip', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      });

      if (res.ok) {
        const text = await res.text();
        const length = Number(res.headers.get('content-length'));

        return { text, wireBytes: Number.isFinite(length) && length > 0 ? length : null };
      }
      if (!RETRY_STATUS.has(res.status) || attempt >= attempts) throw new HttpError(url, res.status);
      wait = retryAfterMs(res.headers.get('retry-after'), maxMs) ?? backoff(attempt);
      why = `HTTP ${res.status}`;
      await res.body?.cancel();
    } catch (err) {
      if (err instanceof HttpError || attempt >= attempts) throw err;
      wait = backoff(attempt);
      why = describeError(err);
    }
    opts.log?.(`  retry ${attempt} of ${attempts - 1} in ${(wait / 1000).toFixed(1)} s after ${why}: ${url}`);
    await sleep(wait);
  }
}

// Runs fn over items with at most `limit` calls in flight, keeping results in input order.
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;

      results[i] = await fn(items[i] as T, i);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}
