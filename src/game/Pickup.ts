/**
 * Within-run drops: EXACTLY two kinds — health (restore HP) and one fire-rate
 * buff (lasts the rest of the run, vanishes on death). Pure: ZERO three/DOM.
 * FIXED-SIZE pool (POOL.pickups); spawning never grows it.
 *
 * NOT an item system: no inventory, no rarity, no pool of items — two kinds,
 * rolled by a seeded RNG, applied immediately on touch.
 */

import { DROP, PICKUP, PLAYER, PLAYER_COMBAT, POOL } from '../utils/constants';
import type { Rng } from '../utils/rng';
import type { PlayerState } from './Player';
import type { GameState } from './GameState';

export type PickupKind = 'health' | 'buff';

export interface Pickup {
  active: boolean;
  x: number;
  y: number;
  kind: PickupKind;
  /** Encounter room this drop belongs to (for telemetry); -1 if none. */
  room: number;
}

export function createPickupPool(): Pickup[] {
  return Array.from({ length: POOL.pickups }, () => ({
    active: false,
    x: 0,
    y: 0,
    kind: 'health' as PickupKind,
    room: -1,
  }));
}

export function spawnPickup(
  pool: Pickup[],
  x: number,
  y: number,
  kind: PickupKind,
  room: number,
): boolean {
  for (const pk of pool) {
    if (pk.active) continue;
    pk.active = true;
    pk.x = x;
    pk.y = y;
    pk.kind = kind;
    pk.room = room;
    return true;
  }
  return false;
}

export function activePickupCount(pool: Pickup[]): number {
  let n = 0;
  for (const pk of pool) if (pk.active) n++;
  return n;
}

/** Seeded drop roll: nothing, health, or buff. Deterministic per RNG state. */
export function rollDrop(rng: Rng): PickupKind | null {
  if (rng.next() >= DROP.chance) return null;
  return rng.next() < DROP.healthShare ? 'health' : 'buff';
}

/** Apply a pickup's effect immediately. Health is capped at max; the buff sets a
 *  within-run fire-rate multiplier (reset on death via createPlayer). Pure. */
export function applyPickup(player: PlayerState, kind: PickupKind): void {
  if (kind === 'health') {
    player.health = Math.min(PLAYER_COMBAT.maxHealth, player.health + DROP.healAmount);
  } else {
    player.fireRateMult = DROP.buffFireRateMult;
  }
}

/** Collect any pickup the player is touching; apply its effect. */
export function updatePickups(state: GameState): void {
  const p = state.player;
  const reach = PICKUP.radius + PLAYER.radius;
  const r2 = reach * reach;
  for (const pk of state.pickups) {
    if (!pk.active) continue;
    const dx = pk.x - p.x;
    const dy = pk.y - p.y;
    if (dx * dx + dy * dy <= r2) {
      applyPickup(p, pk.kind);
      pk.active = false;
      if (pk.room >= 0 && pk.room < state.rooms.length) state.rooms[pk.room].dropsCollected++;
    }
  }
}
