/**
 * GOLDEN CHESTS — a risk/reward loot CHOICE that makes side rooms worth a detour. A
 * chest spawns in 1-2 non-spawn, non-boss rooms per floor (Dungeon picks the rooms;
 * loadFloor places the entities). It opens on CONTACT, but ONLY once its room is
 * CLEARED (a post-fight reward, not a mid-combat grab).
 *
 * On open, a seeded chestRng roll (CHEST.mimicChance) decides:
 *   - LOOT: pop TWO linked pickups — walk over one, the other vanishes (the spatial
 *     1-of-2 choice).
 *   - MIMIC (PR-C): a buffed CHASER bursts out. The room RE-ACTIVATES via the existing
 *     encounter machinery (reactivateRoom → phase 'active' + activeRoom + doors locked),
 *     so the UNCHANGED updateEncounterResolve clears it on the mimic's death — the
 *     #39/#42/#43 path, no new gating logic. The mimic spawns + the room locks
 *     ATOMICALLY in this one call (zero gating window), and the mimic spawns STUNNED
 *     for CHEST.wobbleDuration (frozen, can't damage) so the chest-wobble tell is fair.
 *     Killing it re-clears the room AND pops the chest's loot anyway (a fair gamble:
 *     "free loot vs a fight THEN loot").
 *
 * Pure: ZERO three/DOM. A chest is NOT an enemy (never in the enemy pool), so an
 * UNOPENED chest can't affect roomEnemyCount / the clear-gate. Once a mimic spawns it
 * IS an enemy (tagged to the room) and gates normally.
 */

import { CHEST, PICKUP, PLAYER, POOL } from '../utils/constants';
import { spawnParticles } from './Particle';
import { chooseChestPicks, spawnGuaranteedPickup } from './Pickup';
import { spawnEnemy, roomEnemyCount } from './Enemy';
import { heatStatMults } from './Heat';
import { reactivateRoom } from './Encounter';
import { isSolid } from './Room';
import type { GameState } from './GameState';

export interface Chest {
  active: boolean;
  /** World position (the chest room centre). */
  x: number;
  y: number;
  /** The room this chest sits in (gates opening on that room being cleared). */
  roomIndex: number;
  /** True once opened (its loot has popped, OR it turned out to be a mimic) — the
   *  open path won't re-process it. */
  opened: boolean;
  /** MIMIC (PR-C): true after a mimic burst, until the mimic is killed. While set,
   *  updateChests watches for the room re-clearing (roomEnemyCount → 0) to pop the
   *  chest's loot (the "fight THEN loot" reward). Also the render's wobble signal. */
  mimicFighting: boolean;
}

export function createChestPool(): Chest[] {
  return Array.from({ length: POOL.chests }, () => ({
    active: false,
    x: 0,
    y: 0,
    roomIndex: -1,
    opened: false,
    mimicFighting: false,
  }));
}

/** Per-step: resolve chests. A MIMIC-fighting chest pops its loot once the room
 *  re-clears (mimic dead); an unopened chest opens on contact IF its room is cleared. */
export function updateChests(state: GameState): void {
  const p = state.player;
  const reach = CHEST.openReach + PLAYER.radius;
  const r2 = reach * reach;
  for (let ci = 0; ci < state.chests.length; ci++) {
    const c = state.chests[ci];
    if (!c.active) continue;
    // MIMIC aftermath: the room re-cleared (mimic killed) -> deliver the chest loot
    // (the fair gamble: you fought for it, you still get the 2-pick). roomEnemyCount
    // is read AFTER updateEncounterResolve in the frame loop, so 0 == mimic dead.
    if (c.mimicFighting) {
      if (roomEnemyCount(state.enemies, c.roomIndex) === 0) {
        popLoot(state, c, ci);
        c.mimicFighting = false;
        c.active = false; // chest fully consumed (loot delivered)
      }
      continue;
    }
    if (c.opened) continue; // loot chest already popped
    // GATE: openable only once the room is CLEARED (inert during the fight). So any
    // mimic spawns from a fully-cleared, activeRoom === -1 state (no double-activation).
    const enc = state.rooms[c.roomIndex];
    if (!enc || enc.phase !== 'cleared') continue;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    if (dx * dx + dy * dy > r2) continue;
    openChest(state, c, ci);
  }
}

/** Resolve an opened chest: a seeded roll → MIMIC or LOOT. */
function openChest(state: GameState, c: Chest, ci: number): void {
  c.opened = true;
  spawnParticles(state.particles, c.x, c.y, CHEST.openBurst); // lid-pop / burst tell
  if (state.chestRng.next() < CHEST.mimicChance) {
    // MIMIC: spawn a buffed chaser at the chest, STUNNED for the tell, and RE-ACTIVATE
    // the room — atomically, in this call (zero gating window). The room was cleared
    // (gate above) so activeRoom === -1: reactivateRoom is safe + can't double-activate.
    if (spawnEnemy(state.enemies, c.x, c.y, state.run.depth, 'chaser', c.roomIndex, heatStatMults(state.config.heat))) {
      // The chest room was cleared (0 enemies) before this spawn, so the only enemy
      // tagged to it now IS the mimic.
      const mimic = state.enemies.find((e) => e.active && e.roomIndex === c.roomIndex);
      if (mimic) {
        mimic.health *= CHEST.mimicHpMult;
        mimic.attackDamage *= CHEST.mimicDamageMult;
        mimic.stunTimer = CHEST.wobbleDuration; // frozen during the wobble tell (fair)
      }
      reactivateRoom(state, c.roomIndex); // existing machinery: lock + activeRoom
      c.mimicFighting = true;
      return;
    }
    // Defensive: pool full -> no mimic could spawn. Fall back to LOOT so the chest is
    // never a dud AND we never leave an active room with zero enemies (insta-clear).
  }
  // LOOT: the #70 spatial 1-of-2 choice.
  popLoot(state, c, ci);
}

/** A walkable spot for a pick at (x, y): if that tile is solid (chest jammed near a
 *  wall), mirror across the chest to the open side; if BOTH sides are walled, fall
 *  back to the chest tile itself (always walkable — the chest sits there). The grace
 *  beat means even this degenerate stack still presents the choice. */
function safeSpot(state: GameState, cx: number, cy: number, x: number, y: number): { x: number; y: number } {
  const ts = state.room.tileSize;
  const solidAt = (wx: number, wy: number): boolean => isSolid(state.room, Math.floor(wx / ts), Math.floor(wy / ts));
  if (!solidAt(x, y)) return { x, y };
  const mx = cx - (x - cx);
  const my = cy - (y - cy);
  if (!solidAt(mx, my)) return { x: mx, y: my };
  return { x: cx, y: cy };
}

/** Pop the two linked pickups (the 1-of-2 choice) from the chest. Shared by the loot
 *  roll AND the mimic-killed reward.
 *
 *  PRESENTATION (the #70 instant-collect fix): the pair is spread PERPENDICULAR to the
 *  player's approach direction, so BOTH picks land equidistant off to the sides — never
 *  in the player's path, and the approach side no longer force-decides which is grabbed
 *  (offset > collection reach, so neither is in range at spawn). Each pick also carries
 *  PICKUP.spawnGrace, so the choice is VISIBLE for a beat before either is collectable
 *  even if the player is parked on it. The player then picks by moving toward one. */
function popLoot(state: GameState, c: Chest, ci: number): void {
  const [a, b] = chooseChestPicks(state.player, state.chestRng, state.config.unlocked); // META PR1: unlocked pool
  // pairId = the chest's pool slot + 1 (>= 1, unique per chest) so the two pickups
  // link only to each other — collecting one despawns its sibling (exactly one taken).
  const pairId = ci + 1;
  const off = CHEST.pickupOffset;
  // Unit vector from the player TO the chest = the approach direction. Spread the pair
  // along its perpendicular. Dead-on the chest (no approach dir) → default to a
  // horizontal spread (as if approached from below).
  const p = state.player;
  let ux = c.x - p.x;
  let uy = c.y - p.y;
  const d = Math.hypot(ux, uy);
  if (d > 1e-4) {
    ux /= d;
    uy /= d;
  } else {
    ux = 0;
    uy = -1;
  }
  const px = -uy; // perpendicular unit
  const py = ux;
  const sa = safeSpot(state, c.x, c.y, c.x + px * off, c.y + py * off);
  const sb = safeSpot(state, c.x, c.y, c.x - px * off, c.y - py * off);
  // GUARANTEED: a chest's reward is never lost to a full pickup pool — evict the
  // oldest stale FLOOR drop if needed so both picks always appear (the chest's
  // "reliable reward" identity; a stale uncollected drop is what yields).
  spawnGuaranteedPickup(state.pickups, sa.x, sa.y, a, c.roomIndex, pairId, PICKUP.spawnGrace);
  spawnGuaranteedPickup(state.pickups, sb.x, sb.y, b, c.roomIndex, pairId, PICKUP.spawnGrace);
}

/** Count of live chests — for tests / pool-reuse guards. */
export function activeChestCount(pool: Chest[]): number {
  let n = 0;
  for (const c of pool) if (c.active) n++;
  return n;
}
