/**
 * Pure player state and its update step. ZERO three.js / DOM imports.
 *
 * Movement is velocity-based and SNAPPY (accel/friction ramp). On top of that
 * Phase 2 adds the load-bearing DASH: a committed fixed-distance burst in the
 * current move direction (or facing if idle) with brief i-frames and a cooldown
 * — the mechanic that makes both melee (close in) and ranged (dodge + kite)
 * work. Combat timers all tick here; attacks themselves are resolved by
 * GameState.update (which has the enemy/projectile pools).
 *
 * For render interpolation the player keeps its PREVIOUS sim-step position
 * alongside the current one; the renderer lerps between them by the frame alpha.
 */

import { DASH, ENEMY_COMMON, ISO_YAW, PLAYER, PLAYER_COMBAT, TUNING } from '../utils/constants';
import { clamp } from '../utils/math';
import { resolveX, resolveY } from './Collision';
import type { RoomState } from './Room';
import type { InputIntent } from './Input';

// Rotation that maps raw SCREEN input (+x right, +y down) onto the world floor
// plane (the real 45° under the restored iso camera). Computed ONCE from ISO_YAW.
const ISO_COS = Math.cos(-ISO_YAW);
const ISO_SIN = Math.sin(-ISO_YAW);

export interface PlayerState {
  /** Current world position, world units. */
  x: number;
  y: number;
  /** Position at the start of the current sim step (for render interpolation). */
  prevX: number;
  prevY: number;
  /** Velocity, world units per second. */
  vx: number;
  vy: number;
  /** Facing/aim-fallback unit vector (world); tracks the last move direction. */
  facingX: number;
  facingY: number;
  health: number;
  alive: boolean;
  /** Dash burst remaining, seconds (> 0 = mid-dash, committed). */
  dashTimer: number;
  dashDirX: number;
  dashDirY: number;
  /** Dash charges currently available (the dash ECONOMY). Starts full
   *  (= maxCharges). Each dash spends one; they refill ONE AT A TIME at the
   *  (faster-recharge-adjusted) rate. max = dashMaxCharges(player). */
  dashCharges: number;
  /** Time left until the next charge regenerates, seconds (0 = idle/at-max). */
  dashRechargeTimer: number;
  /** Invulnerability from a dash, seconds. */
  iframeTimer: number;
  /** Brief invulnerability after taking a hit, seconds. */
  hitInvulnTimer: number;
  /** Melee cooldown, seconds. */
  meleeCdTimer: number;
  /** Melee swing animation window (for rendering the arc), seconds. */
  meleeAnimTimer: number;
  /** Ranged fire cooldown, seconds. */
  rangedCdTimer: number;
  /** Hit-flash window, seconds. */
  hitFlashTimer: number;
  /** MELEE powerup LEVEL (0..3, within-run; Phase 9 escalating powerups). 0 = base
   *  swing (TUNING.meleeDamage). Each level raises damage (MELEE_LEVELS), and the
   *  cap (3) also widens reach/arc. Reset to 0 on death via createPlayer. */
  meleeLevel: number;
  /** RANGED powerup LEVEL (0..3, within-run). 0 = single shot. Each level adds a
   *  projectile to a spread (RANGED_LEVELS.shots). Reset to 0 on death. */
  rangedLevel: number;
  /** PIERCE powerup LEVEL (0..3, within-run): ranged shots pass THROUGH up to
   *  PIERCE_LEVELS[level] distinct enemies (0 = first-hit-stops, 3 = infinite —
   *  the pre-Phase-9 behaviour). Reset to 0 on death via createPlayer. */
  pierceLevel: number;
  /** KNOCKBACK powerup LEVEL (0..3, within-run): melee hits apply a shove scaled
   *  by KNOCKBACK_LEVELS[level] (0 = base MELEE.knockback). PR1 scales FORCE only;
   *  stun (II) + AoE (III) land in PR2. Reset to 0 on death via createPlayer. */
  knockbackLevel: number;
  /** EXTRA-CHARGE powerup LEVEL (0..3, within-run; Phase 9 PR3): each level adds
   *  DASH.extraChargeBonus to the dash-charge ceiling (I=+1 → 2, II → 3, III → 4).
   *  0 = base (1 charge). Reset to 0 on death via createPlayer. */
  extraChargeLevel: number;
  /** FASTER-RECHARGE powerup (within-run): dash charges refill quicker
   *  (×TUNING.dashFasterRechargeFactor). Binary toggle; reset via createPlayer. */
  fasterRecharge: boolean;
  /** DASH-STRIKE powerup (within-run): a dash DAMAGES enemies it sweeps through,
   *  for REDUCED i-frames (TUNING.dashStrikeIframes). Binary toggle; reset via
   *  createPlayer. */
  dashStrike: boolean;
  /** LIFESTEAL powerup LEVEL (0..3, within-run; synergy arc PR1 — the first on-hit
   *  EFFECT axis). 0 = none; each level heals a bigger fraction of DIRECT-hit damage
   *  (LIFESTEAL_LEVELS.frac). Auto-multiplies with melee/multishot/pierce/dash-strike
   *  via the shared damageEnemy hook. DoT (PR2 burn) is excluded. Reset to 0 on
   *  death via createPlayer; carried across descent. */
  lifestealLevel: number;
  /** BURN powerup LEVEL (0..3, within-run; synergy arc PR2 — the DoT effect axis).
   *  0 = none; a direct hit IGNITES the enemy for BURN_LEVELS.dps[level] over
   *  BURN_LEVELS.duration (refresh-not-stack). Auto-multiplies with multishot/pierce/
   *  dash-strike via the shared damageEnemy hook. Reset to 0 on death; carried across
   *  descent. */
  burnLevel: number;
  /** CHAIN powerup LEVEL (0..3, within-run; synergy arc PR3 — the arc effect axis).
   *  0 = none; a direct hit ARCS to up to CHAIN_LEVELS.maxJumps[level] nearby enemies
   *  (falloff damage, dedup, no re-chain). Arcs carry burn-ignite → chain×burn =
   *  wildfire. Auto-multiplies with multishot/pierce/dash-strike via damageEnemy.
   *  Reset to 0 on death; carried across descent. */
  chainLevel: number;
  /** CRIT powerup LEVEL (0..3, within-run; synergy arc PR4 — the FINALE multiplier).
   *  0 = never crits; each level raises the crit CHANCE (CRIT_LEVELS.chance) for a
   *  fixed ×multiplier hit. Rolled in damageEnemy on a direct hit (seeded combatRng)
   *  BEFORE lifesteal/chain read the damage → a crit spikes both + the wildfire base
   *  free. Reset to 0 on death; carried across descent. */
  critLevel: number;
  /** Enemy-pool indices hit by the CURRENT dash — so one dash damages each enemy
   *  at most once (mirrors Projectile.hits). Allocated once; cleared on each dash. */
  dashHits: Set<number>;
  /** Dodge confirmation render-tell window, seconds (> 0 right after a dash
   *  i-frame negated a hit). Drives the dodge flash; pure feedback, not logic. */
  dodgeFxTimer: number;
}

export function createPlayer(x: number, y: number): PlayerState {
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    vx: 0,
    vy: 0,
    facingX: 0,
    facingY: 1,
    health: PLAYER_COMBAT.maxHealth,
    alive: true,
    dashTimer: 0,
    dashDirX: 0,
    dashDirY: 1,
    // Starts FULL: no powerups yet, so max = base charges.
    dashCharges: DASH.baseCharges,
    dashRechargeTimer: 0,
    iframeTimer: 0,
    hitInvulnTimer: 0,
    meleeCdTimer: 0,
    meleeAnimTimer: 0,
    rangedCdTimer: 0,
    hitFlashTimer: 0,
    dodgeFxTimer: 0,
    meleeLevel: 0,
    rangedLevel: 0,
    pierceLevel: 0,
    knockbackLevel: 0,
    extraChargeLevel: 0,
    fasterRecharge: false,
    dashStrike: false,
    lifestealLevel: 0,
    burnLevel: 0,
    chainLevel: 0,
    critLevel: 0,
    dashHits: new Set<number>(),
  };
}

/** Max dash charges given the player's powerups (base + extra-charge bonus). */
export function dashMaxCharges(player: PlayerState): number {
  return DASH.baseCharges + player.extraChargeLevel * DASH.extraChargeBonus;
}

/** True while the player can't be damaged (dash i-frames or post-hit i-frames). */
export function isInvulnerable(player: PlayerState): boolean {
  return player.iframeTimer > 0 || player.hitInvulnTimer > 0;
}

/** Move velocity toward (tx, ty) by at most `maxDelta`, preserving direction. */
function approachVelocity(player: PlayerState, tx: number, ty: number, maxDelta: number): void {
  const dvx = tx - player.vx;
  const dvy = ty - player.vy;
  const dist = Math.hypot(dvx, dvy);
  if (dist <= maxDelta || dist === 0) {
    player.vx = tx;
    player.vy = ty;
    return;
  }
  player.vx += (dvx / dist) * maxDelta;
  player.vy += (dvy / dist) * maxDelta;
}

/** Refill dash charges one at a time at the (faster-recharge-adjusted) rate.
 *  Idle (timer 0) once at max; a fresh charge restarts the timer if still below. */
function tickDashRecharge(player: PlayerState, dt: number): void {
  const max = dashMaxCharges(player);
  if (player.dashCharges >= max) {
    player.dashRechargeTimer = 0;
    return;
  }
  const rechargeTime = TUNING.dashRecharge * (player.fasterRecharge ? TUNING.dashFasterRechargeFactor : 1);
  if (player.dashRechargeTimer <= 0) player.dashRechargeTimer = rechargeTime; // (re)start
  player.dashRechargeTimer -= dt;
  if (player.dashRechargeTimer <= 0) {
    player.dashCharges += 1;
    player.dashRechargeTimer = 0; // next step restarts it if still below max
  }
}

function tickTimers(player: PlayerState, dt: number): void {
  if (player.dashTimer > 0) player.dashTimer = Math.max(0, player.dashTimer - dt);
  if (player.iframeTimer > 0) player.iframeTimer = Math.max(0, player.iframeTimer - dt);
  if (player.hitInvulnTimer > 0) player.hitInvulnTimer = Math.max(0, player.hitInvulnTimer - dt);
  if (player.meleeCdTimer > 0) player.meleeCdTimer = Math.max(0, player.meleeCdTimer - dt);
  if (player.meleeAnimTimer > 0) player.meleeAnimTimer = Math.max(0, player.meleeAnimTimer - dt);
  if (player.rangedCdTimer > 0) player.rangedCdTimer = Math.max(0, player.rangedCdTimer - dt);
  if (player.hitFlashTimer > 0) player.hitFlashTimer = Math.max(0, player.hitFlashTimer - dt);
  if (player.dodgeFxTimer > 0) player.dodgeFxTimer = Math.max(0, player.dodgeFxTimer - dt);
}

/**
 * Advance the player one fixed step: tick timers, handle the dash, ramp velocity
 * (or apply the committed dash burst), update facing, then integrate with
 * axis-separated wall collision. Attacks are resolved by the caller.
 */
export function updatePlayer(
  player: PlayerState,
  intent: InputIntent,
  dt: number,
  room: RoomState,
): void {
  player.prevX = player.x;
  player.prevY = player.y;
  tickTimers(player, dt);
  tickDashRecharge(player, dt);
  if (!player.alive) return;

  // Rotate raw screen input into the world floor plane, then normalize.
  const rx = intent.moveX * ISO_COS - intent.moveY * ISO_SIN;
  const ry = intent.moveX * ISO_SIN + intent.moveY * ISO_COS;
  const len = Math.hypot(rx, ry);
  const hasInput = len > 0;
  const mdx = hasInput ? rx / len : 0;
  const mdy = hasInput ? ry / len : 0;

  if (hasInput) {
    player.facingX = mdx;
    player.facingY = mdy;
  }

  // Dash (edge-triggered, consumed here so one press = one dash). Spends a charge
  // (the dash economy); recharge above refills them one at a time.
  if (intent.dash) {
    intent.dash = false;
    if (player.dashCharges >= 1 && player.dashTimer <= 0) {
      player.dashCharges -= 1;
      player.dashTimer = DASH.duration;
      // DASH-STRIKE trades invulnerability for offence: a damaging dash gets the
      // REDUCED i-frame duration; a normal dodge-dash keeps the full one.
      player.iframeTimer = player.dashStrike ? TUNING.dashStrikeIframes : TUNING.dashIframes;
      player.dashHits.clear(); // fresh per-dash hit-set
      player.dashDirX = hasInput ? mdx : player.facingX;
      player.dashDirY = hasInput ? mdy : player.facingY;
    }
  }

  if (player.dashTimer > 0) {
    // Committed burst — fixed speed, ignores steering.
    const dashSpeed = TUNING.dashDist / DASH.duration;
    player.vx = player.dashDirX * dashSpeed;
    player.vy = player.dashDirY * dashSpeed;
  } else {
    const targetVx = hasInput ? mdx * TUNING.maxSpeed : 0;
    const targetVy = hasInput ? mdy * TUNING.maxSpeed : 0;
    const rate = hasInput ? TUNING.accel : TUNING.friction;
    approachVelocity(player, targetVx, targetVy, rate * dt);
  }

  // Integrate one axis at a time (stop + slide on walls). A dash stops dead at a
  // wall rather than tunnelling. Each resolved step is capped to < 1 tile
  // (ENEMY_COMMON.maxStepTiles — shared with the enemy cap from the softlock
  // hardening): legit moves (maxSpeed/dash) are well under it, but if the
  // single-resolve collision ever EJECTS the player from a cell that turned
  // solid under them, this bounds it so a resolver ejection can't fling the
  // player across the map a full tile per tick.
  const r = PLAYER.radius;
  const maxStep = ENEMY_COMMON.maxStepTiles * room.tileSize;

  const dx = player.vx * dt;
  const nx = clamp(resolveX(player.x, player.y, dx, r, room), player.x - maxStep, player.x + maxStep);
  if (nx !== player.x + dx) player.vx = 0;
  player.x = nx;

  const dy = player.vy * dt;
  const ny = clamp(resolveY(player.x, player.y, dy, r, room), player.y - maxStep, player.y + maxStep);
  if (ny !== player.y + dy) player.vy = 0;
  player.y = ny;
}
