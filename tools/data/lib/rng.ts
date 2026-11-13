// Bit for bit the mockup's FNV-1a and mulberry32, so a seed gives the same draws in the tools and in the app.

export function hash32(str: string): number {
  let h = 2166136261;

  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stable draw in [0, 1) for one key, independent of everything else in the build.
export function unitHash(key: string): number {
  return hash32(key) / 4294967296;
}
