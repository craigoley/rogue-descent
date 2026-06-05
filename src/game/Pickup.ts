/**
 * Within-run drops: health (restore HP) + SEVEN powerups. Five are LEVELED tracks
 * (MELEE, RANGED, PIERCE, KNOCKBACK, EXTRA-CHARGE — stack to tier III via Phase 9);
 * two upgrade the DASH as binary toggles (FASTER-RECHARGE, DASH-STRIKE).
 * Powerups last the rest of the run (carried across descent) and reset on
 * death/new-run. Pure: ZERO three/DOM. FIXED-SIZE pool (POOL.pickups); spawning
 * never grows it.
 *
 * NOT an item system: no inventory, no rarity, no stacking — rolled by a seeded
 * RNG, applied immediately on touch.
 */

import { DROP, PICKUP, PLAYER, PLAYER_COMBAT, POOL, POWERUP_MAX_LEVEL } from '../utils/constants';
import type { Rng } from '../utils/rng';
import { dashMaxCharges, type PlayerState } from './Player';
import type { GameState } from './GameState';

export type PickupKind =
  | 'health'
  | 'melee'
  | 'ranged'
  | 'pierce'
  | 'knockback'
  | 'extraCharge'
  | 'fasterRecharge'
  | 'dashStrike';

/** The powerup kinds (everything except health), picked uniformly when a drop is
 *  a powerup. Order is irrelevant to determinism (index is a pure fn of the roll).
 *  Phase 9: melee/ranged/pierce/knockback/extraCharge are LEVELED (stack to tier
 *  III); fasterRecharge + dashStrike remain binary toggles. */
const POWERUP_KINDS: readonly PickupKind[] = [
  'melee',
  'ranged',
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

/** Seeded drop roll: nothing, health, or one of the seven powerups. Deterministic
 *  per RNG state — first roll gates drop-vs-nothing + health-vs-powerup, the
 *  second (only consumed for a powerup) picks uniformly among POWERUP_KINDS. */
export function rollDrop(rng: Rng): PickupKind | null {
  if (rng.next() >= DROP.chance) return null;
  if (rng.next() < DROP.healthShare) return 'health';
  const i = Math.min(POWERUP_KINDS.length - 1, Math.floor(rng.next() * POWERUP_KINDS.length));
  return POWERUP_KINDS[i];
}

/** Increment a leveled powerup, capped at POWERUP_MAX_LEVEL (Phase 9): picking up
 *  a kind you already have raises its tier I→II→III; a 4th is a no-op. */
function levelUp(level: number): number {
  return Math.min(level + 1, POWERUP_MAX_LEVEL);
}

export function applyPickup(player: PlayerState, kind: PickupKind): void {
  if (kind === 'health') {
    player.health = Math.min(PLAYER_COMBAT.maxHealth, player.health + DROP.healAmount);
  } else if (kind === 'melee') {
    player.meleeLevel = levelUp(player.meleeLevel);
  } else if (kind === 'ranged') {
    player.rangedLevel = levelUp(player.rangedLevel);
  } else if (kind === 'pierce') {
    player.pierceLevel = levelUp(player.pierceLevel);
  } else if (kind === 'knockback') {
    player.knockbackLevel = levelUp(player.knockbackLevel);
  } else if (kind === 'extraCharge') {
    // Phase 9 PR3: extra-charge is now a LEVEL — each pickup raises the dash
    // ceiling by one (cap III). Refill to the NEW max so the charge is felt on
    // pickup (the original "grant immediately" pop).
    player.extraChargeLevel = levelUp(player.extraChargeLevel);
    player.dashCharges = dashMaxCharges(player);
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
