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

import { DASH, ISO_YAW, PLAYER, PLAYER_COMBAT, TUNING } from '../utils/constants';
import { resolveX, resolveY } from './Collision';
import type { RoomState } from './Room';
import type { InputIntent } from './Input';

// Rotation that maps raw SCREEN input (+x right, +y down) onto the world floor
// plane (identity while the camera has zero yaw). Computed ONCE from ISO_YAW.
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
  /** Time until the next dash is allowed, seconds. */
  dashCdTimer: number;
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
    dashCdTimer: 0,
    iframeTimer: 0,
    hitInvulnTimer: 0,
    meleeCdTimer: 0,
    meleeAnimTimer: 0,
    rangedCdTimer: 0,
    hitFlashTimer: 0,
  };
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

function tickTimers(player: PlayerState, dt: number): void {
  if (player.dashTimer > 0) player.dashTimer = Math.max(0, player.dashTimer - dt);
  if (player.dashCdTimer > 0) player.dashCdTimer = Math.max(0, player.dashCdTimer - dt);
  if (player.iframeTimer > 0) player.iframeTimer = Math.max(0, player.iframeTimer - dt);
  if (player.hitInvulnTimer > 0) player.hitInvulnTimer = Math.max(0, player.hitInvulnTimer - dt);
  if (player.meleeCdTimer > 0) player.meleeCdTimer = Math.max(0, player.meleeCdTimer - dt);
  if (player.meleeAnimTimer > 0) player.meleeAnimTimer = Math.max(0, player.meleeAnimTimer - dt);
  if (player.rangedCdTimer > 0) player.rangedCdTimer = Math.max(0, player.rangedCdTimer - dt);
  if (player.hitFlashTimer > 0) player.hitFlashTimer = Math.max(0, player.hitFlashTimer - dt);
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

  // Dash (edge-triggered, consumed here so one press = one dash).
  if (intent.dash) {
    intent.dash = false;
    if (player.dashCdTimer <= 0 && player.dashTimer <= 0) {
      player.dashTimer = DASH.duration;
      player.dashCdTimer = DASH.duration + TUNING.dashCooldown;
      player.iframeTimer = TUNING.dashIframes;
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
  // wall rather than tunnelling.
  const r = PLAYER.radius;
  const dx = player.vx * dt;
  const nx = resolveX(player.x, player.y, dx, r, room);
  if (nx !== player.x + dx) player.vx = 0;
  player.x = nx;

  const dy = player.vy * dt;
  const ny = resolveY(player.x, player.y, dy, r, room);
  if (ny !== player.y + dy) player.vy = 0;
  player.y = ny;
}
