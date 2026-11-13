import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { cacheDir, openCache } from '../lib/cache.ts';
import { getText, HttpError, mapLimit, type FetchFn } from '../lib/http.ts';

function scripted(...steps: Array<number | Error>): { fetch: FetchFn; calls: () => number } {
  let calls = 0;
  const fetch: FetchFn = async () => {
    const step = steps[Math.min(calls, steps.length - 1)];

    calls++;
    if (step instanceof Error) throw step;

    return new Response(step === 200 ? '{"ok":true}' : 'nope', { status: step ?? 500, headers: step === 429 ? { 'retry-after': '3' } : {} });
  };

  return { fetch, calls: () => calls };
}

describe('getText', () => {
  const dnsHiccup = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) });

  test('retries server errors and network failures with growing waits, then succeeds', async () => {
    const waits: number[] = [];
    const s = scripted(503, dnsHiccup, 200);
    const res = await getText('https://example.test/x', { fetch: s.fetch, sleep: async (ms) => void waits.push(ms), random: () => 0.5 });

    assert.equal(res.text, '{"ok":true}');
    assert.equal(s.calls(), 3);
    assert.deepEqual(waits, [1000, 2000]);
  });

  test('honours Retry-After on a rate limit', async () => {
    const waits: number[] = [];
    const s = scripted(429, 200);

    await getText('https://example.test/x', { fetch: s.fetch, sleep: async (ms) => void waits.push(ms) });
    assert.deepEqual(waits, [3000]);
  });

  test('fails at once on a 404', async () => {
    const s = scripted(404);

    await assert.rejects(getText('https://example.test/x', { fetch: s.fetch, sleep: async () => undefined }), (e) => e instanceof HttpError && e.status === 404);
    assert.equal(s.calls(), 1);
  });

  test('gives up after the last attempt', async () => {
    const s = scripted(dnsHiccup);

    await assert.rejects(getText('https://example.test/x', { fetch: s.fetch, attempts: 3, sleep: async () => undefined }), /fetch failed/);
    assert.equal(s.calls(), 3);
  });
});

test('mapLimit keeps order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (v) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, v));
    running--;

    return v * 10;
  });

  assert.deepEqual(out, [50, 10, 40, 20, 30, 0, 60]);
  assert.equal(peak, 3);
});

describe('cache', () => {
  test('lives in UE_CACHE_DIR, else under LOCALAPPDATA', () => {
    assert.equal(cacheDir({ UE_CACHE_DIR: 'X', LOCALAPPDATA: 'Y' }), 'X');
    assert.equal(cacheDir({ LOCALAPPDATA: 'Y' }), join('Y', 'umpires-eye', 'mlb-cache'));
  });

  test('stores gzipped text and reads it back', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ue-cache-'));

    try {
      const cache = openCache(dir);

      assert.equal(cache.readJson('a/b.json.gz'), null);
      cache.writeText('a/b.json.gz', '{"n":1}');
      assert.equal(cache.has('a/b.json.gz'), true);
      assert.deepEqual(cache.readJson('a/b.json.gz'), { n: 1 });
      assert.deepEqual(cache.list('a'), ['b.json.gz']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
