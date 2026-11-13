import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FETCH_TIMEOUT_MS, fetchJson, matchBuild, type Net } from '../../src/data/fetch';
import { LoadError, type LoadErrorKind } from '../../src/data/source';

/** What one try gets: an answer, a failure, no answer at all, or headers and then a body that never finishes. */
type Answer = Response | Error | 'no answer' | 'stalled body';

/** A network that gives each try the next answer, and records when each try was made and how. */
function fakeNet(answers: Answer[], onLine: () => boolean = () => true): { net: Net; tries: { url: string; init: RequestInit; at: number }[] } {
  const tries: { url: string; init: RequestInit; at: number }[] = [];
  const net: Net = {
    onLine,
    fetch: (url, init) => {
      const answer = answers.shift() ?? new Error('the fake network has no answer left');
      // as a browser does, aborting the request fails it, or the body still being read
      const aborted = (fail: (reason: unknown) => void): void => init.signal?.addEventListener('abort', () => fail(init.signal?.reason));

      tries.push({ url, init, at: Date.now() });
      if (answer === 'no answer') return new Promise((_, reject) => aborted(reject));
      if (answer === 'stalled body') return Promise.resolve(new Response(new ReadableStream({ start: (c) => aborted((r) => c.error(r)) })));

      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };

  return { net, tries };
}

const what = 'the file';

describe('the fetch helper', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the parsed body, asked for with the cache mode it was given', async () => {
    const { net, tries } = fakeNet([Response.json({ build: 'b1' })]);

    await expect(fetchJson('manifest.json', { what, cache: 'no-cache', net })).resolves.toEqual({ build: 'b1' });
    expect(tries.map((t) => [t.url, t.init.cache])).toEqual([['manifest.json', 'no-cache']]);
  });

  it('tries again after 0.5 s and then 2 s when there was no answer or a server error', async () => {
    const { net, tries } = fakeNet([new TypeError('Failed to fetch'), new Response('', { status: 503 }), Response.json([7])]);
    const got = fetchJson('f.json', { what, net });

    await vi.advanceTimersByTimeAsync(2500);
    await expect(got).resolves.toEqual([7]);
    expect(tries.map((t) => t.at)).toEqual([0, 500, 2500]);
  });

  it('gives up after the third failure, as one a later retry may fix', async () => {
    const { net, tries } = fakeNet([new TypeError('Failed to fetch'), new Response('', { status: 500 }), new Response('', { status: 502, statusText: 'Bad Gateway' })]);
    const got = fetchJson('f.json', { what, net }).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(2500);
    expect(await got).toMatchObject({ kind: 'network', message: 'Could not load the file (502 Bad Gateway).' });
    expect(tries).toHaveLength(3);
  });

  it('gives each try 15 s, body included, and counts a timeout as a failure to retry', async () => {
    const { net, tries } = fakeNet(['no answer', 'stalled body', 'no answer']);
    const got = fetchJson('slow.json', { what, net }).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(3 * FETCH_TIMEOUT_MS + 2500 - 1);
    expect(tries.map((t) => t.at)).toEqual([0, 15_500, 32_500]);
    expect(tries.map((t) => t.init.signal?.aborted)).toEqual([true, true, false]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await got).toMatchObject({ kind: 'network', message: 'Could not reach the file: no answer within 15 s.' });
  });

  it("never retries by itself a 404, another refusal, a web page sent in the file's place, or bad JSON", async () => {
    const cases: [Response, LoadErrorKind, string | RegExp][] = [
      [new Response('Not Found', { status: 404, statusText: 'Not Found' }), 'missing', 'Could not load the file (404 Not Found).'],
      // HTTP/2 answers, GitHub Pages' among them, have no reason phrase
      [new Response('', { status: 404 }), 'missing', 'Could not load the file (404).'],
      [new Response('', { status: 403, statusText: 'Forbidden' }), 'data', 'Could not load the file (403 Forbidden).'],
      [new Response('<!doctype html><title>Umpire’s Eye</title>', { headers: { 'content-type': 'text/html' } }), 'missing', 'Could not load the file: the server sent a web page instead.'],
      [new Response('\n<html>', { headers: { 'content-type': 'application/octet-stream' } }), 'missing', 'Could not load the file: the server sent a web page instead.'],
      [new Response('{"pitches": [', { headers: { 'content-type': 'application/json' } }), 'data', /^Could not read the file: it isn't valid JSON \(.+\)\.$/],
    ];

    for (const [answer, kind, words] of cases) {
      const { net, tries } = fakeNet([answer, Response.json({})]);
      const e = await fetchJson('f.json', { what, net }).catch((err: unknown) => err);

      expect(e).toBeInstanceOf(LoadError);
      expect(e).toMatchObject({ kind, message: typeof words === 'string' ? words : expect.stringMatching(words) });
      await vi.advanceTimersByTimeAsync(5000);
      expect(tries).toHaveLength(1);
    }
  });

  it('is offline without asking the network when the device is offline, and stops retrying when it goes offline', async () => {
    const offline = fakeNet([Response.json({})], () => false);

    await expect(fetchJson('f.json', { what, net: offline.net })).rejects.toMatchObject({ kind: 'offline', message: 'Could not reach the file: this device is offline.' });
    expect(offline.tries).toHaveLength(0);

    let onLine = true;
    const dropped = fakeNet([new TypeError('Failed to fetch'), Response.json({})], () => onLine);
    const got = fetchJson('f.json', { what, net: dropped.net }).catch((e: unknown) => e);

    onLine = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(await got).toMatchObject({ kind: 'offline' });
    expect(dropped.tries).toHaveLength(1);
  });

  it("stops at once with the caller's reason when the caller cancels, waiting or asking", async () => {
    const reason = new Error('the date changed');
    const waiting = fakeNet([new TypeError('Failed to fetch'), Response.json({})]);
    const ac = new AbortController();
    const got = fetchJson('f.json', { what, net: waiting.net, signal: ac.signal }).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(100);
    ac.abort(reason);
    expect(await got).toBe(reason);
    await vi.advanceTimersByTimeAsync(5000);
    expect(waiting.tries).toHaveLength(1);

    const asking = fakeNet(['no answer']);
    const ac2 = new AbortController();
    const got2 = fetchJson('f.json', { what, net: asking.net, signal: ac2.signal }).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(100);
    ac2.abort(reason);
    expect(await got2).toBe(reason);
    expect(asking.tries[0]?.init.signal?.aborted).toBe(true);

    const before = fakeNet([Response.json({})]);

    await expect(fetchJson('f.json', { what, net: before.net, signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(before.tries).toHaveLength(0);
  });
});

describe('matching a file to the manifest by build', () => {
  const refetcher = (manifest: string, file: string) => ({
    manifest: vi.fn(() => Promise.resolve({ build: manifest, from: 'refetch' })),
    file: vi.fn(() => Promise.resolve({ build: file, from: 'refetch' })),
  });
  const first = (build: string) => ({ build, from: 'first' });

  it("keeps a file from the manifest's build without asking again", async () => {
    const refetch = refetcher('b2', 'b2');

    await expect(matchBuild(first('b2'), first('b2'), refetch, what)).resolves.toEqual({ manifest: first('b2'), file: first('b2') });
    expect(refetch.manifest).not.toHaveBeenCalled();
    expect(refetch.file).not.toHaveBeenCalled();
  });

  it('fetches the manifest again for a stale file, and then the file under the build the manifest names', async () => {
    const refetch = refetcher('b2', 'b2');
    const got = await matchBuild(first('b2'), first('b1'), refetch, what);

    expect(got).toEqual({ manifest: { build: 'b2', from: 'refetch' }, file: { build: 'b2', from: 'refetch' } });
    expect(refetch.manifest).toHaveBeenCalledTimes(1);
    expect(refetch.file.mock.calls).toEqual([['b2']]);
  });

  it('settles a stale manifest by fetching the manifest alone again', async () => {
    const refetch = refetcher('b2', 'b2');

    await expect(matchBuild(first('b1'), first('b2'), refetch, what)).resolves.toEqual({ manifest: { build: 'b2', from: 'refetch' }, file: first('b2') });
    expect(refetch.file).not.toHaveBeenCalled();
  });

  it('calls a mismatch that survives both broken data', async () => {
    const refetch = refetcher('b2', 'b1');

    await expect(matchBuild(first('b2'), first('b1'), refetch, what)).rejects.toMatchObject({
      kind: 'data',
      message: "Could not match the file to the manifest: it's from build b1, the manifest from build b2.",
    });
    expect(refetch.manifest).toHaveBeenCalledTimes(1);
    expect(refetch.file).toHaveBeenCalledTimes(1);
  });
});
