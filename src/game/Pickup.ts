/**
 * Within-run drops: health (restore HP) + EIGHT powerups. Five are LEVELED stat
 * tracks (MELEE, RANGED, PIERCE, KNOCKBACK, EXTRA-CHARGE — stack to tier III);
 * two upgrade the DASH as binary toggles (FASTER-RECHARGE, DASH-STRIKE); one is
 * a leveled on-hit EFFECT axis (LIFESTEAL — synergy arc). Stat tracks are COMMON
 * (DROP.trackWeight); effect axes are UNCOMMON (DROP.effectWeight) so they read as
 * build-defining. Powerups last the rest of the run (carried across descent) and
 * reset on death/new-run. Pure: ZERO three/DOM. FIXED-SIZE pool (POOL.pickups);
 * spawning never grows it.
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
  | 'dashStrike'
  | 'lifesteal'
  | 'burn'
  | 'chain'
  | 'crit';

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
  'lifesteal', // APPEND new kinds — existing indices stay stable (tests pin them)
  'burn',
  'chain',
  'crit',
];

/** On-hit EFFECT axes (synergy arc) — picked UNCOMMONLY (DROP.effectWeight) vs the
 *  stat-tracks (DROP.trackWeight) so effects read as build-defining, not common
 *  top-ups. Grows with burn/chain/crit. Drives the weighted roll in rollDrop. */
const EFFECT_KINDS: ReadonlySet<PickupKind> = new Set<PickupKind>(['lifesteal', 'burn', 'chain', 'crit']);

/** Roll weight for a powerup kind: effect axes are uncommon, stat-tracks common. */
function powerupWeight(kind: PickupKind): number {
  return EFFECT_KINDS.has(kind) ? DROP.effectWeight : DROP.trackWeight;
}

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

/** Seeded drop roll: nothing, health, or one of the eight powerups. Deterministic
 *  per RNG state — first roll gates drop-vs-nothing + health-vs-powerup, the
 *  second (only consumed for a powerup) picks via a WEIGHTED cumulative walk
 *  (stat-tracks common, effect axes uncommon). */
export function rollDrop(rng: Rng): PickupKind | null {
  if (rng.next() >= DROP.chance) return null;
  if (rng.next() < DROP.healthShare) return 'health';
  // WEIGHTED powerup pick (synergy arc): effect axes are rarer than stat-tracks.
  // One draw, cumulative-weight walk — same draw COUNT as the old uniform pick (so
  // downstream roll sequences / the scarcity acceptDraw stay positionally stable).
  let total = 0;
  for (const k of POWERUP_KINDS) total += powerupWeight(k);
  let r = rng.next() * total;
  for (const k of POWERUP_KINDS) {
    r -= powerupWeight(k);
    if (r < 0) return k;
  }
  return POWERUP_KINDS[POWERUP_KINDS.length - 1]; // floating-point safety net
}

/** Increment a leveled powerup, capped at POWERUP_MAX_LEVEL (Phase 9): picking up
 *  a kind you already have raises its tier I→II→III; a 4th is a no-op. */
function levelUp(level: number): number {
  return Math.min(level + 1, POWERUP_MAX_LEVEL);
}

/** The player's CURRENT level in a powerup track (Phase 9 scarcity gate). Leveled
 *  kinds return their int level; binary kinds (fasterRecharge/dashStrike) return 0
 *  when unowned or POWERUP_MAX_LEVEL when owned — so an owned repeat reads as
 *  "maxed" and gets rejected (the dead-repeat-drop fix). 'health' is not a powerup
 *  (callers gate it out); returns 0. */
export function currentPowerupLevel(player: PlayerState, kind: PickupKind): number {
  switch (kind) {
    case 'melee':
      return player.meleeLevel;
    case 'ranged':
      return player.rangedLevel;
    case 'pierce':
      return player.pierceLevel;
    case 'knockback':
      return player.knockbackLevel;
    case 'extraCharge':
      return player.extraChargeLevel;
    case 'lifesteal':
      return player.lifestealLevel;
    case 'burn':
      return player.burnLevel;
    case 'chain':
      return player.chainLevel;
    case 'crit':
      return player.critLevel;
    case 'fasterRecharge':
      return player.fasterRecharge ? POWERUP_MAX_LEVEL : 0;
    case 'dashStrike':
      return player.dashStrike ? POWERUP_MAX_LEVEL : 0;
    default:
      return 0; // health
  }
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
  } else if (kind === 'lifesteal') {
    player.lifestealLevel = levelUp(player.lifestealLevel);
  } else if (kind === 'burn') {
    player.burnLevel = levelUp(player.burnLevel);
  } else if (kind === 'chain') {
    player.chainLevel = levelUp(player.chainLevel);
  } else if (kind === 'crit') {
    player.critLevel = levelUp(player.critLevel);
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
