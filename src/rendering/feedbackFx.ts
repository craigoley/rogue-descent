/**
 * Pure helpers for the render/feedback-polish effects (juice). Kept in their own
 * module — ZERO three/DOM imports — so the timing curves + the once-per-run cue
 * decision are unit-testable without standing up the WebGL renderer (the same
 * pattern as softlock.ts / depthFade.ts).
 *
 * All three read EXISTING sim edges via render-side frame-diffs (the kill-pop #90
 * idiom); none mutate sim state.
 */

import { PICKUP_POP, SPAWN } from '../utils/constants';

/**
 * Generic POP curve (shared with the kill-pop): a fast UP-phase to 1+overshoot,
 * then an accelerating collapse to 0 — the figure "pops" out of existence. Pure:
 * the remaining timer + its full duration/shape params → scale, no state. (Mirrors
 * EntityRenderer.popScale; lives here so the pickup pop can be unit-tested.)
 */
export function popScale(
  timerRemaining: number,
  duration: number,
  overshoot: number,
  upFrac: number,
): number {
  const t = 1 - timerRemaining / duration; // 0 at trigger → 1 at end
  if (t < upFrac) return 1 + overshoot * (t / upFrac);
  const u = (t - upFrac) / (1 - upFrac);
  return (1 + overshoot) * (1 - u * u); // → 0
}

/** PICKUP POP (C): the on-collect kind-coloured pop scale for the pickup mesh. */
export function pickupPopScale(timerRemaining: number): number {
  return popScale(
    timerRemaining,
    PICKUP_POP.popDuration,
    PICKUP_POP.popOvershoot,
    PICKUP_POP.popUpFrac,
  );
}

/**
 * SPAWN SCALE-IN (B): ease-out 0→1 over SPAWN.scaleInDuration, multiplied on top of
 * the enemy's base render scale. Ease-OUT so most of the size lands in the first
 * couple frames — the enemy reads as present-and-incoming instantly (never hides a
 * threat). `timerRemaining` counts DOWN from scaleInDuration to 0.
 */
export function spawnInScale(timerRemaining: number): number {
  const t = 1 - timerRemaining / SPAWN.scaleInDuration; // 0 at spawn → 1 at end
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - c) * (1 - c); // easeOutQuad
}

/**
 * WILDFIRE CUE (A): should the one-shot "WILDFIRE!" label fire THIS frame? True only
 * on the first wildfire kill since it was armed — i.e. the counter just incremented
 * (kills > prevKills) and we haven't cued yet (`cued` false). The caller re-arms
 * (`cued` → false) when the counter RESETS on a new run (kills < prevKills), so a
 * reset frame returns false here (kills 0 is not > prevKills). Pure decision; the
 * caller owns the `cued` latch + the position.
 */
export function shouldCueWildfire(prevKills: number, kills: number, cued: boolean): boolean {
  return kills > prevKills && !cued;
}
