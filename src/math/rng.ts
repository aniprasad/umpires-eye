export type Rand = () => number;

/** FNV-1a: a stable 32-bit seed from a pitch id or any other string. */
export function hash32(str: string): number {
  let h = 2166136261;

  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

/** mulberry32: deterministic per seed, so replays, URL states and tests all see the same draws. */
export function rng(seed: number): Rand {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: one standard normal draw from two uniform draws. */
export function gauss(r: Rand): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());
}
