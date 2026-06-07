/**
 * GOLDEN CHESTS (PR1) — a risk/reward loot CHOICE that makes side rooms worth a
 * detour. A chest spawns in 1-2 non-spawn, non-boss rooms per floor (Dungeon picks
 * the rooms; loadFloor places the entities). It opens on CONTACT, but ONLY once its
 * room is CLEARED (a post-fight reward, not a mid-combat grab) — and on open it pops
 * TWO linked pickups: walk over one and its sibling vanishes (the spatial 1-of-2
 * choice). Pure: ZERO three/DOM.
 *
 * A chest is NOT an enemy and never enters the enemy pool, so it can't affect
 * roomEnemyCount / the clear-gate (it's optional loot, like the stairs). PR2 will
 * insert the loot-vs-mimic roll at the open site (re-activating the room via the
 * existing encounter path) — PR1 is always loot, so it adds zero gating surface.
 */

import { CHEST, PLAYER, POOL } from '../utils/constants';
import { spawnParticles } from './Particle';
import { chooseChestPicks, spawnPickup } from './Pickup';
import type { GameState } from './GameState';

export interface Chest {
  active: boolean;
  /** World position (the chest room centre). */
  x: number;
  y: number;
  /** The room this chest sits in (gates opening on that room being cleared). */
  roomIndex: number;
  /** True once opened (its loot has popped) — inert thereafter. */
  opened: boolean;
}

export function createChestPool(): Chest[] {
  return Array.from({ length: POOL.chests }, () => ({
    active: false,
    x: 0,
    y: 0,
    roomIndex: -1,
    opened: false,
  }));
}

/** Per-step: open any unopened chest the player is touching, IF its room is cleared.
 *  Opening pops the two linked pickups (the 1-of-2 choice) + a spark burst. */
export function updateChests(state: GameState): void {
  const p = state.player;
  const reach = CHEST.openReach + PLAYER.radius;
  const r2 = reach * reach;
  for (let ci = 0; ci < state.chests.length; ci++) {
    const c = state.chests[ci];
    if (!c.active || c.opened) continue;
    // GATE: openable only once the room is CLEARED (inert during the fight). Reading
    // phase here means a chest can never be looted mid-encounter — and (PR2) any
    // mimic spawns from a fully-cleared, activeRoom === -1 state.
    const enc = state.rooms[c.roomIndex];
    if (!enc || enc.phase !== 'cleared') continue;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    if (dx * dx + dy * dy > r2) continue;
    openChest(state, c, ci);
  }
}

/** Resolve an opened chest. PR1: always loot — pop the two linked pickups. (PR2
 *  inserts the mimic roll before this.) */
function openChest(state: GameState, c: Chest, ci: number): void {
  c.opened = true;
  spawnParticles(state.particles, c.x, c.y, CHEST.openBurst); // lid-pop tell
  const [a, b] = chooseChestPicks(state.player, state.chestRng);
  // pairId = the chest's pool slot + 1 (>= 1, unique per chest) so the two pickups
  // link only to each other — collecting one despawns its sibling (exactly one taken).
  const pairId = ci + 1;
  spawnPickup(state.pickups, c.x - CHEST.pickupOffset, c.y, a, c.roomIndex, pairId);
  spawnPickup(state.pickups, c.x + CHEST.pickupOffset, c.y, b, c.roomIndex, pairId);
}

/** Count of live chests — for tests / pool-reuse guards. */
export function activeChestCount(pool: Chest[]): number {
  let n = 0;
  for (const c of pool) if (c.active) n++;
  return n;
}
