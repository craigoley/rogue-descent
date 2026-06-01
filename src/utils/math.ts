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

/**
 * Normalize a 2D vector to unit length, returning a new {x, y}. A zero-length
 * vector is returned unchanged (still {0, 0}), so diagonal input is scaled to
 * the same speed as cardinal input without ever dividing by zero.
 */
export function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}
