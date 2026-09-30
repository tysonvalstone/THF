/** Small seeded PRNG (mulberry32) so simulated activity repeats for the same demo run and date */
export type Rng = () => number;

export function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFor = (seed: string): Rng => mulberry32(hashSeed(seed));

/** Deterministic shuffle (Fisher-Yates) */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Rounds x up or down at random so small expected counts still happen sometimes */
export function stochasticRound(x: number, rng: Rng): number {
  const base = Math.floor(x);
  return base + (rng() < x - base ? 1 : 0);
}
