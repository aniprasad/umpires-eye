// The app's one way to load a data file (docs/M2-DESIGN.md §5.3). Every failure comes back as a LoadError whose kind
// picks the start screen's state, so the sources never look at a status code themselves.
import { LoadError } from './source';

/** Per try, reading the body included. */
export const FETCH_TIMEOUT_MS = 15_000;

/** The waits before the second and third tries. Only failures a retry may fix are retried: the `network` kind. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 2000];

/** What the helper needs from the browser. Tests pass a fake. */
export interface Net {
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** False when the device says it has no connection. */
  onLine(): boolean;
}

export const BROWSER_NET: Net = {
  // looked up on every call, so a test that stubs the global fetch reaches the sources' default too
  fetch: (url, init) => fetch(url, init),
  onLine: () => navigator.onLine !== false,
};

export interface FetchJsonOptions {
  /** What the file holds, for messages: "the pitch data". */
  readonly what: string;
  /** How the HTTP cache is used (§4.3). */
  readonly cache?: RequestCache;
  /** Cancels the request and any retry still to come. The promise then rejects with the signal's reason. */
  readonly signal?: AbortSignal;
  readonly net?: Net;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * A JSON file's parsed body, which the caller still has to check. Rejects with a LoadError:
 * - offline when the device is offline before a try;
 * - network after three tries that got no answer, timed out or met a server error;
 * - missing for a 404, or for a web page sent in the file's place;
 * - data for any other refusal, or a body that isn't JSON.
 */
export function fetchJson(url: string, opts: FetchJsonOptions): Promise<unknown> {
  return withRetries(() => fetchOnce(url, opts), RETRY_DELAYS_MS, opts);
}

async function withRetries<T>(run: () => Promise<T>, delays: readonly number[], opts: FetchJsonOptions): Promise<T> {
  if (!(opts.net ?? BROWSER_NET).onLine()) throw new LoadError('offline', `Could not reach ${opts.what}: this device is offline.`);
  try {
    return await run();
  } catch (e) {
    const [delay, ...rest] = delays;

    if (delay === undefined || !(e instanceof LoadError) || e.kind !== 'network') throw e;
    await sleep(delay, opts.signal);

    return withRetries(run, rest, opts);
  }
}

async function fetchOnce(url: string, opts: FetchJsonOptions): Promise<unknown> {
  const { what, signal } = opts;
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, FETCH_TIMEOUT_MS);
  const cancel = (): void => ac.abort(signal?.reason);

  signal?.addEventListener('abort', cancel);
  try {
    signal?.throwIfAborted();
    const res = await (opts.net ?? BROWSER_NET).fetch(url, { cache: opts.cache, signal: ac.signal });
    // HTTP/2 has no reason phrase, so GitHub Pages' answers come without one
    const refused = `Could not load ${what} (${res.statusText ? `${res.status} ${res.statusText}` : res.status}).`;

    if (res.status === 404) throw new LoadError('missing', refused);
    if (res.status >= 500) throw new LoadError('network', refused);
    if (!res.ok) throw new LoadError('data', refused);
    const text = await res.text();

    // A server that answers with a page, such as Vite's single-page fallback or a captive portal, didn't have the file.
    if (/html/i.test(res.headers.get('content-type') ?? '') || text.trimStart().startsWith('<')) {
      throw new LoadError('missing', `Could not load ${what}: the server sent a web page instead.`);
    }

    return parseJson(text, what);
  } catch (e) {
    if (e instanceof LoadError) throw e;
    if (signal?.aborted) throw signal.reason;

    throw new LoadError('network', timedOut
      ? `Could not reach ${what}: no answer within ${FETCH_TIMEOUT_MS / 1000} s.`
      : `Could not reach ${what} (${message(e)}).`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new LoadError('data', `Could not read ${what}: it isn't valid JSON (${message(e)}).`);
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);

    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
  });
}

/** A file stamped with the build of the data it came from (§4.3). */
export interface Built {
  readonly build: string;
}

/** The address that skips any cached copy made under another build. */
export const versioned = (url: string, build: string): string => `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(build)}`;

/**
 * A file and a manifest from the same build (§4.3). GitHub Pages lets browsers keep either one for ten minutes, so a
 * deploy can pair a fresh copy with a stale one. On a mismatch the manifest is fetched again past the cache, and then,
 * unless that settled it, the file at the address the fresh manifest gives it: `versioned()` by the build, or a shard's
 * own ?v=. A mismatch that survives both is broken data.
 */
export async function matchBuild<M extends Built, F extends Built>(
  manifest: M,
  file: F,
  refetch: { readonly manifest: () => Promise<M>; readonly file: (fresh: M) => Promise<F> },
  what: string,
): Promise<{ readonly manifest: M; readonly file: F }> {
  if (file.build === manifest.build) return { manifest, file };
  const fresh = await refetch.manifest();

  if (file.build === fresh.build) return { manifest: fresh, file };
  const again = await refetch.file(fresh);

  if (again.build !== fresh.build) {
    throw new LoadError('data', `Could not match ${what} to the manifest: it's from build ${again.build}, the manifest from build ${fresh.build}.`);
  }

  return { manifest: fresh, file: again };
}
