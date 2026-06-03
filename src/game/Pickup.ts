/**
 * Within-run drops: health (restore HP) + FOUR powerups. Two are verb-coupled —
 * PIERCE (ranged shots pass through enemies) and KNOCKBACK (melee launches) — and
 * two upgrade the dash ECONOMY: EXTRA-CHARGE (a second dash before recharge) and
 * FASTER-RECHARGE (charges refill quicker). Powerups are binary toggles that
 * change what a verb/resource DOES; they last the rest of the run (carried across
 * descent) and vanish on death/new-run. Pure: ZERO three/DOM. FIXED-SIZE pool
 * (POOL.pickups); spawning never grows it.
 *
 * NOT an item system: no inventory, no rarity, no stacking — rolled by a seeded
 * RNG, applied immediately on touch.
 */

import { DASH, DROP, PICKUP, PLAYER, PLAYER_COMBAT, POOL } from '../utils/constants';
import type { Rng } from '../utils/rng';
import type { PlayerState } from './Player';
import type { GameState } from './GameState';

export type PickupKind =
  | 'health'
  | 'pierce'
  | 'knockback'
  | 'extraCharge'
  | 'fasterRecharge'
  | 'dashStrike';

/** The powerup kinds (everything except health), picked uniformly when a drop is
 *  a powerup. Order is irrelevant to determinism (index is a pure fn of the roll). */
const POWERUP_KINDS: readonly PickupKind[] = [
  'pierce',
  'knockback',
  'extraCharge',
  'fasterRecharge',
  'dashStrike',
];

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

/** Seeded drop roll: nothing, health, or one of the four powerups. Deterministic
 *  per RNG state — first roll gates drop-vs-nothing + health-vs-powerup, the
 *  second (only consumed for a powerup) picks uniformly among POWERUP_KINDS. */
export function rollDrop(rng: Rng): PickupKind | null {
  if (rng.next() >= DROP.chance) return null;
  if (rng.next() < DROP.healthShare) return 'health';
  const i = Math.min(POWERUP_KINDS.length - 1, Math.floor(rng.next() * POWERUP_KINDS.length));
  return POWERUP_KINDS[i];
}

/** Apply a pickup's effect immediately. Health is capped at max; the powerups
 *  flip a within-run behaviour toggle (reset on death via createPlayer). Pure. */
export function applyPickup(player: PlayerState, kind: PickupKind): void {
  if (kind === 'health') {
    player.health = Math.min(PLAYER_COMBAT.maxHealth, player.health + DROP.healAmount);
  } else if (kind === 'pierce') {
    player.pierce = true;
  } else if (kind === 'knockback') {
    player.meleeKnockback = true;
  } else if (kind === 'extraCharge') {
    // Raise the dash cap and grant the new charge immediately (felt on pickup).
    player.extraCharge = true;
    player.dashCharges = DASH.baseCharges + DASH.extraChargeBonus;
  } else if (kind === 'fasterRecharge') {
    player.fasterRecharge = true;
  } else {
    player.dashStrike = true;
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
