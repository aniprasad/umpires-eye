export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const easeOut3 = (t: number): number => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const smooth = (t: number): number => {
  const u = clamp(t, 0, 1);

  return u * u * (3 - 2 * u);
};

export const ramp = (x: number, a: number, b: number): number => clamp((x - a) / (b - a), 0, 1);
