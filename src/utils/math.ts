/**
 * Pure math helpers. No dependencies, fully Node-testable.
 */

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Linear interpolation between `a` and `b` by factor `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
