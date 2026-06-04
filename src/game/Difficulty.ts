/**
 * Depth-based difficulty scaling (Phase 7c). PURE: ZERO three/DOM. Maps the
 * run's current depth to the ONE existing enemy type's count + stat multipliers
 * (no new AI — that's Phase 7.5). Depth 1 is baseline: count =
 * ENCOUNTER.enemiesPerRoom, every multiplier = 1.0 (so floor 1 is unchanged).
 *
 * All curves are linear in depth (smooth + monotonic, no spikes) and read their
 * slopes from DIFFICULTY. Depth is clamped to >= 1 defensively. See the DIFFICULTY
 * block in constants.ts for the curve + tuning rationale.
 */

import { DIFFICULTY, ENCOUNTER, POOL } from '../utils/constants';

/** Enemies spawned per room at `depth`: a little more early, capped at the pool. */
export function enemiesPerRoomForDepth(depth: number): number {
  const d = Math.max(1, depth);
  const n = ENCOUNTER.enemiesPerRoom + Math.floor((d - 1) * DIFFICULTY.enemiesPerRoomPerDepth);
  return Math.min(POOL.enemies, n);
}

/** How many of a room's enemies are RANGED at `depth` (Phase 7.5). They
 *  SUBSTITUTE for chasers within enemiesPerRoomForDepth (no added density), so
 *  the count curve stays meaningful. Deterministic (no RNG): 0 below
 *  rangedMinDepth, then rises, always clamped to leave >= 1 chaser. */
export function rangedCountForDepth(depth: number): number {
  const d = Math.max(1, depth);
  if (d < DIFFICULTY.rangedMinDepth) return 0;
  const raw =
    DIFFICULTY.rangedBase + Math.floor((d - DIFFICULTY.rangedMinDepth) * DIFFICULTY.rangedPerDepth);
  return Math.max(0, Math.min(raw, enemiesPerRoomForDepth(d) - 1));
}

/** How many of a room's enemies are SWARMERS at `depth` (Phase 7.6). Like ranged,
 *  they SUBSTITUTE for chasers within the count (no added density) — filling slots
 *  LEFT after chasers and ranged, so chasers + ranged + swarmers always leave
 *  >= 1 chaser. Deterministic (no RNG). */
export function swarmerCountForDepth(depth: number): number {
  const d = Math.max(1, depth);
  if (d < DIFFICULTY.swarmerMinDepth) return 0;
  const raw =
    DIFFICULTY.swarmerBase + Math.floor((d - DIFFICULTY.swarmerMinDepth) * DIFFICULTY.swarmerPerDepth);
  // Leave room for >= 1 chaser AND all the ranged.
  const free = enemiesPerRoomForDepth(d) - 1 - rangedCountForDepth(d);
  return Math.max(0, Math.min(raw, free));
}

/** Enemy max-health multiplier at `depth` (1.0 at depth 1). */
export function healthMultForDepth(depth: number): number {
  return 1 + (Math.max(1, depth) - 1) * DIFFICULTY.healthMultPerDepth;
}

/** Enemy attack-damage multiplier at `depth` (1.0 at depth 1). */
export function damageMultForDepth(depth: number): number {
  return 1 + (Math.max(1, depth) - 1) * DIFFICULTY.damageMultPerDepth;
}

/** Enemy move-speed multiplier at `depth` (1.0 at depth 1). */
export function speedMultForDepth(depth: number): number {
  return 1 + (Math.max(1, depth) - 1) * DIFFICULTY.speedMultPerDepth;
}
