import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng.ts';
import { fromPoolFile, type PoolFile } from '../../src/data/ws2026';
import { pickPoolTen } from '../../src/math/deal';
import { synthPitch } from './fixtures';

const data = fromPoolFile(JSON.parse(readFileSync(new URL('../../public/data/ws-2026/pool.json', import.meta.url), 'utf8')) as PoolFile);

describe('Another ten on the World Series pool', () => {
  it("deals the self-test's 200 seeded tens exactly as the original dealer did", () => {
    const rand = mulberry32(20261031);
    const deals = Array.from({ length: 200 }, () => pickPoolTen(data.deck, data.today, rand).map((p) => p.id).join(','));

    expect(deals[0]).toBe('849802-25-3,849802-12-1,849802-71-2,849804-3-2,849804-18-3,849804-29-5,849804-44-2,849803-2-4,849803-8-1,849803-77-2');
    // Recorded from the original pickPoolTen, before core's dealer replaced it.
    expect(createHash('sha256').update(deals.join('|')).digest('hex')).toBe('a52a35ecb5ba73a473d134ecc4b62bfdadeb7ce526218ec8be21d2e987159e9a');
  });

  it('throws, rather than deal a short ten, when the pool has run out', () => {
    expect(() => pickPoolTen([synthPitch()], [], mulberry32(1))).toThrow("Another ten couldn't be dealt");
  });
});
