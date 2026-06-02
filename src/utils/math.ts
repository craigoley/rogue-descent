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

/** A mutable 2D point/vector. */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Camera dead-zone follow (pure). Given the current focus (fx, fy) and the
 * target (px, py) — both in world units — the focus does NOT move while the
 * target is within `deadZone` of it (so the player can drift on screen = "I'm
 * moving", not "the world moves"). Once the target is beyond the dead-zone, the
 * focus eases (factor `k` in [0,1]) toward the point that keeps the target
 * exactly on the dead-zone boundary, so the follow is smooth (k = 1 - e^(-rate*dt)).
 *
 * Writes the new focus into `out` and returns it — no allocation, so it's safe
 * to call every frame with a reused scratch object.
 */
export function deadZoneFollow(
  fx: number,
  fy: number,
  px: number,
  py: number,
  deadZone: number,
  k: number,
  out: Vec2,
): Vec2 {
  const dx = px - fx;
  const dy = py - fy;
  const dist = Math.hypot(dx, dy);
  if (dist <= deadZone) {
    out.x = fx;
    out.y = fy;
    return out;
  }
  // Target focus that places the player exactly on the dead-zone boundary.
  const tx = px - (dx / dist) * deadZone;
  const ty = py - (dy / dist) * deadZone;
  out.x = fx + (tx - fx) * k;
  out.y = fy + (ty - fy) * k;
  return out;
}
