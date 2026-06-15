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

import { DROP, PICKUP, PLAYER, POOL, POWERUP_MAX_LEVEL } from '../utils/constants';
import type { Rng } from '../utils/rng';
import { dashMaxCharges, playerMaxHealth, type PlayerState } from './Player';
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
  | 'crit'
  | 'freeze'
  | 'fireRate'
  | 'maxHp'
  | 'damageReduction';

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
  'freeze', // meta PR1 — LOCKABLE: only enters the pool when unlocked (see LOCKABLE_KINDS)
  'fireRate', // meta PR2 — LOCKABLE track: enters the pool only when 'fireRate' is unlocked
  'maxHp', // DEFENSIVE track — BASE (always in the pool): the +max-HP build axis
  'damageReduction', // DEFENSIVE track — BASE: the damage-reduction (armor) build axis
];

/** On-hit EFFECT axes (synergy arc) — picked UNCOMMONLY (DROP.effectWeight) vs the
 *  stat-tracks (DROP.trackWeight) so effects read as build-defining, not common
 *  top-ups. Grows with burn/chain/crit. Drives the weighted roll in rollDrop. */
const EFFECT_KINDS: ReadonlySet<PickupKind> = new Set<PickupKind>(['lifesteal', 'burn', 'chain', 'crit', 'freeze']);

/** META PR1 — LOCKABLE kinds: present in POWERUP_KINDS but absent from a run's pool
 *  UNLESS the run config's `unlocked` set lists them. Base/default config unlocks none
 *  of these, so a clean save plays EXACTLY like today (the regression guard). Grows as
 *  more unlockables land. */
const LOCKABLE_KINDS: ReadonlySet<PickupKind> = new Set<PickupKind>(['freeze', 'fireRate']);

/** Empty unlocked-set default (= base config: no lockables available). Shared, frozen. */
const NO_UNLOCKS: ReadonlySet<string> = new Set<string>();

/** The powerup kinds AVAILABLE this run: every kind except lockables the run hasn't
 *  unlocked. Pure (config in → pool out); the run config is a pure input, no storage. */
function availableKinds(unlocked: ReadonlySet<string>): readonly PickupKind[] {
  return POWERUP_KINDS.filter((k) => !LOCKABLE_KINDS.has(k) || unlocked.has(k));
}

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
  /** GOLDEN CHESTS: links the two pickups a chest pops as a PAIR — collecting one
   *  deactivates its sibling(s) with the same pairId (the spatial 1-of-2 choice:
   *  exactly one is taken). -1 = a normal, un-paired drop. */
  pairId: number;
  /** Monotonic spawn order — the OLDEST active floor drop (lowest seq) is evicted
   *  first when a chest reward needs room in a full pool (spawnGuaranteedPickup).
   *  Deterministic (a counter, no rng); mirrors Particle.ts's burstSeed. */
  seq: number;
  /** PRESENTATION GRACE (seconds) remaining: while > 0 the pickup is VISIBLE but
   *  NOT collectable (updatePickups counts it down and skips collection). Set on
   *  GOLDEN-CHEST picks (PICKUP.spawnGrace) so the 1-of-2 choice always presents;
   *  0 for floor drops (instant-grab). */
  spawnGrace: number;
  /** Was this pickup actually COLLECTED (taken by the player → applyPickup ran), as
   *  opposed to DISCARDED as a rejected pair-sibling? Both deactivate, but only a
   *  collected pick should announce — the renderer fires the name toast on the
   *  active→inactive frame ONLY when this is set, so a discarded sibling is removed
   *  SILENTLY (you didn't get it). A feedback marker only — never read by sim logic. */
  collected: boolean;
}

/** Monotonic spawn counter (deterministic, like Particle.burstSeed) for eviction age. */
let spawnSeq = 0;

export function createPickupPool(): Pickup[] {
  return Array.from({ length: POOL.pickups }, () => ({
    active: false,
    x: 0,
    y: 0,
    kind: 'health' as PickupKind,
    room: -1,
    pairId: -1,
    seq: 0,
    spawnGrace: 0,
    collected: false,
  }));
}

export function spawnPickup(
  pool: Pickup[],
  x: number,
  y: number,
  kind: PickupKind,
  room: number,
  pairId = -1,
  grace = 0,
): boolean {
  for (const pk of pool) {
    if (pk.active) continue;
    pk.active = true;
    pk.x = x;
    pk.y = y;
    pk.kind = kind;
    pk.room = room;
    pk.pairId = pairId;
    pk.seq = spawnSeq++;
    pk.spawnGrace = grace;
    pk.collected = false; // reset on reuse — only set true if actually taken
    return true;
  }
  return false;
}

/** Spawn a pickup that MUST appear — a GOLDEN-CHEST reward, which is guaranteed loot.
 *  If the pool is full, evict the OLDEST active FLOOR drop (pairId < 0 — never another
 *  chest's pick) to make room, so a chest's loot is never silently lost to pool
 *  pressure. Oldest by spawn `seq` (deterministic, no rng → the L1 fuzz stays clean).
 *  No-op only in the unreachable case that every slot is already a chest pick. */
export function spawnGuaranteedPickup(
  pool: Pickup[],
  x: number,
  y: number,
  kind: PickupKind,
  room: number,
  pairId: number,
  grace = 0,
): void {
  if (spawnPickup(pool, x, y, kind, room, pairId, grace)) return;
  let victim: Pickup | null = null;
  for (const pk of pool) {
    if (pk.active && pk.pairId < 0 && (victim === null || pk.seq < victim.seq)) victim = pk;
  }
  if (victim) {
    victim.active = false;
    spawnPickup(pool, x, y, kind, room, pairId, grace);
  }
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
export function rollDrop(
  rng: Rng,
  unlocked: ReadonlySet<string> = NO_UNLOCKS,
  lean: string | null = null,
): PickupKind | null {
  if (rng.next() >= DROP.chance) return null;
  if (rng.next() < DROP.healthShare) return 'health';
  // WEIGHTED powerup pick (synergy arc): effect axes are rarer than stat-tracks.
  // One draw, cumulative-weight walk — same draw COUNT as the old uniform pick (so
  // downstream roll sequences / the scarcity acceptDraw stay positionally stable).
  // META PR1: the pool is the run's AVAILABLE kinds (lockables filtered unless
  // unlocked) — base config = today's kinds exactly, so the draw stream is unchanged.
  // META L2: the run's LEAN kind (config.runStart) gets DROP.leanWeightMult — picked
  // more often. STILL one rng draw → the draw stream + drop COUNT are unchanged; only
  // WHICH kind is picked shifts (power-neutral). lean null / unmatched = no effect.
  const pool = availableKinds(unlocked);
  const weight = (k: PickupKind): number => powerupWeight(k) * (k === lean ? DROP.leanWeightMult : 1);
  let total = 0;
  for (const k of pool) total += weight(k);
  let r = rng.next() * total;
  for (const k of pool) {
    r -= weight(k);
    if (r < 0) return k;
  }
  return pool[pool.length - 1]; // floating-point safety net
}

/** META LAYER 2 — the kinds a run-start LEAN can target: the AVAILABLE leveled powerups
 *  (effects + stat tracks), excluding the binary dash toggles + health (you lean toward a
 *  build DIRECTION you find + level, not a one-shot toggle). The set grows with unlocks
 *  (freeze/fireRate join once unlocked) — the Layer 1↔2 tie. Pure (config in → list out). */
const NON_LEANABLE: ReadonlySet<PickupKind> = new Set<PickupKind>(['fasterRecharge', 'dashStrike']);
export function leanableKinds(unlocked: ReadonlySet<string> = NO_UNLOCKS): PickupKind[] {
  return availableKinds(unlocked).filter((k) => !NON_LEANABLE.has(k));
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
    case 'freeze':
      return player.freezeLevel;
    case 'fireRate':
      return player.fireRateLevel;
    case 'maxHp':
      return player.hpLevel;
    case 'damageReduction':
      return player.drLevel;
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
    player.health = Math.min(playerMaxHealth(player), player.health + DROP.healAmount);
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
  } else if (kind === 'freeze') {
    player.freezeLevel = levelUp(player.freezeLevel);
  } else if (kind === 'fireRate') {
    player.fireRateLevel = levelUp(player.fireRateLevel);
  } else if (kind === 'maxHp') {
    // Raise the HP cap AND heal the added amount, so the bigger pool is felt on pickup
    // (mirrors extra-charge's refill). The delta is exactly DEFENSE.hpPerLevel — 0 once
    // maxed, so a capped repeat is a clean no-op.
    const before = playerMaxHealth(player);
    player.hpLevel = levelUp(player.hpLevel);
    player.health += playerMaxHealth(player) - before;
  } else if (kind === 'damageReduction') {
    player.drLevel = levelUp(player.drLevel);
  } else if (kind === 'fasterRecharge') {
    player.fasterRecharge = true;
  } else {
    player.dashStrike = true;
  }
}

/** Collect any pickup the player is touching; apply its effect. A pickup with a
 *  PRESENTATION GRACE still counting down is VISIBLE but NOT collectable — the grace
 *  ticks here and collection is skipped until it expires (so a GOLDEN-CHEST 1-of-2
 *  choice always presents before either pick can be grabbed, even if the player
 *  overlaps one). Floor drops spawn with grace 0 → collectable immediately. */
export function updatePickups(state: GameState, dt: number): void {
  const p = state.player;
  const reach = PICKUP.radius + PLAYER.radius;
  const r2 = reach * reach;
  for (const pk of state.pickups) {
    if (!pk.active) continue;
    if (pk.spawnGrace > 0) {
      pk.spawnGrace = Math.max(0, pk.spawnGrace - dt); // presentation beat: shown, not yet grabbable
      continue;
    }
    const dx = pk.x - p.x;
    const dy = pk.y - p.y;
    if (dx * dx + dy * dy <= r2) {
      applyPickup(p, pk.kind);
      pk.active = false;
      pk.collected = true; // TAKEN → it announces (the renderer toasts a collected pick only)
      if (pk.room >= 0 && pk.room < state.rooms.length) state.rooms[pk.room].dropsCollected++;
      // GOLDEN CHESTS: a paired pickup (the 1-of-2 choice) deactivates its sibling(s)
      // the instant it's taken — so exactly ONE of the two is ever collected. Handles
      // the simultaneous-overlap case too: the sibling is gone before the loop reaches it.
      // The sibling is DISCARDED, not collected: deactivate WITHOUT setting `collected`,
      // so it's removed silently (no name toast — you rejected it, you didn't get it).
      if (pk.pairId >= 0) {
        for (const other of state.pickups) {
          if (other !== pk && other.active && other.pairId === pk.pairId) other.active = false;
        }
      }
    }
  }
}

/** GOLDEN CHESTS — choose the TWO distinct kinds a chest offers (the 1-of-2 choice).
 *  Bias for an INTERESTING decision: guaranteed one EFFECT axis (burn/chain/lifesteal/
 *  crit — build-defining) + one STAT track or health (reliable power/sustain), BOTH
 *  filtered to non-maxed for this player (never a dead pick). FALLBACKS keep it always
 *  two LIVE options: no effect available (all maxed) -> two distinct stats/health;
 *  the fully-degenerate all-maxed case -> health + health (both heal). Deterministic
 *  via the passed rng (state.chestRng). */
export function chooseChestPicks(
  player: PlayerState,
  rng: Rng,
  unlocked: ReadonlySet<string> = NO_UNLOCKS,
): [PickupKind, PickupKind] {
  const open = (k: PickupKind): boolean => currentPowerupLevel(player, k) < POWERUP_MAX_LEVEL;
  // META PR1: only offer AVAILABLE kinds (lockables filtered unless unlocked).
  const pool = availableKinds(unlocked);
  const effects = pool.filter((k) => EFFECT_KINDS.has(k) && open(k));
  const stats = pool.filter((k) => !EFFECT_KINDS.has(k) && open(k));
  // Health is always a valid "stat-side" pick (it's not a leveled track).
  const statPool: PickupKind[] = [...stats, 'health'];
  const pick = (arr: PickupKind[]): PickupKind => arr[rng.int(0, arr.length - 1)];
  if (effects.length > 0) {
    return [pick(effects), pick(statPool)]; // the interesting effect-vs-power choice
  }
  // No effect available: offer two DISTINCT stat-side options (degenerate all-maxed
  // -> health + health, both heal — a harmless floor, exceedingly rare).
  const a = pick(statPool);
  const rest = statPool.filter((k) => k !== a);
  const b = rest.length > 0 ? pick(rest) : a;
  return [a, b];
}
