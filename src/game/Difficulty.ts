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

import { BOSS, DIFFICULTY, ENEMY_TYPES, ENCOUNTER, HEAT, POOL } from '../utils/constants';

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

/** Boss HP at `depth` (Phase 8). DEPTH 1 uses the flat gentle override (BOSS
 *  .depth1Health — the single-phase intro); the WIN-DEPTH W (HEAT.unlockDepth) uses the
 *  FINAL-boss carve-out (BOSS.finalHealth — the distinguished climax, the inverse of
 *  depth 1); every other depth keeps the EXACT 7c curve (base × healthMultForDepth), so
 *  neither carve-out can flatten the curve between. */
export function bossHpForDepth(depth: number): number {
  const d = Math.max(1, depth);
  if (d === 1) return BOSS.depth1Health;
  if (d === HEAT.unlockDepth) return BOSS.finalHealth;
  return ENEMY_TYPES.boss.maxHealth * healthMultForDepth(d);
}

/** Boss slam damage at `depth` (Phase 8). DEPTH 1 = the gentle override; the WIN-DEPTH W
 *  = the FINAL-boss carve-out (BOSS.finalDamage); every other depth keeps the 7c curve. */
export function bossDamageForDepth(depth: number): number {
  const d = Math.max(1, depth);
  if (d === 1) return BOSS.depth1Damage;
  if (d === HEAT.unlockDepth) return BOSS.finalDamage;
  return ENEMY_TYPES.boss.attackDamage * damageMultForDepth(d);
}

/** How many PHASES the boss runs at `depth` (Phase 8): 1 (single-phase, lighter
 *  teaching fight) below bossTwoPhaseMinDepth, else 2 (escalates at 50% HP). */
export function bossPhasesForDepth(depth: number): 1 | 2 {
  return Math.max(1, depth) >= DIFFICULTY.bossTwoPhaseMinDepth ? 2 : 1;
}

/** The boss-gimmick rotation (Phase 8). All three are built: #1 (positioning),
 *  #2 (adds), #3 (knockback-interrupt). The rotation below picks each up by depth.
 *
 *  CADENCE with the modulo below + the phase-2-only summon: depth 1 positioning,
 *  depth 2 adds (single-phase -> NEVER summons, a plain slam fight), depth 3
 *  KNOCKBACK (the first interrupt boss; two-phase), depth 4 positioning, depth 5
 *  adds (two-phase -> the FIRST summoning boss), depth 6 knockback, ... So adds
 *  first manifest at depth 5 (summon is gated to phase 2, which needs depth >=
 *  bossTwoPhaseMinDepth) and the knockback-interrupt boss first appears at depth 3. */
const BOSS_GIMMICKS = ['positioning', 'adds', 'knockback'] as const;
/** Includes 'final' — the win-depth (W) carve-out, NOT part of the rotation roster. */
export type BossGimmickId = (typeof BOSS_GIMMICKS)[number] | 'final';

/** Which boss GIMMICK is active at `depth` (Phase 8): the WIN-DEPTH W (HEAT.unlockDepth)
 *  is the DISTINCT FINAL boss ('final' — the combined summon+cleave gimmick, the climax);
 *  every other depth rotates through the roster by depth so successive floors vary. */
export function bossGimmickForDepth(depth: number): BossGimmickId {
  const d = Math.max(1, depth);
  if (d === HEAT.unlockDepth) return 'final';
  return BOSS_GIMMICKS[(d - 1) % BOSS_GIMMICKS.length];
}
