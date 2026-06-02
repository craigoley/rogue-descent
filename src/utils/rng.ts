/**
 * Tiny seeded PRNG (mulberry32). Pure and deterministic: the same seed always
 * yields the same sequence, so anything driven by it (the dungeon generator) is
 * reproducible and unit-testable. The fleet rule bans Math.random in game
 * logic — pass one of these in instead.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(lo: number, hi: number): number {
      if (hi <= lo) return lo;
      return lo + Math.floor(next() * (hi - lo + 1));
    },
  };
}
