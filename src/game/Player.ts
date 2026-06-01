/**
 * Pure player state and its update step. ZERO three.js / DOM imports — this is
 * the canonical "player moves via state, never via the render loop" rule the
 * whole project is built on. `updatePlayer` mutates in place (the only mutation
 * path) so no per-frame allocation happens in the loop.
 *
 * Movement is velocity-based and SNAPPY: each step the velocity is driven
 * toward (input direction × maxSpeed) at a high `accel`, and toward rest at a
 * high `friction` when input releases — so it reaches/leaves top speed in ~2-3
 * sim steps. The brief ramp (rather than setting position directly) is what
 * makes it read as responsive instead of lifeless.
 *
 * For render interpolation the player keeps its PREVIOUS sim-step position
 * alongside the current one; the renderer lerps between them by the frame alpha.
 */

import { PLAYER, TUNING } from '../utils/constants';
import { resolveX, resolveY } from './Collision';
import type { RoomState } from './Room';
import type { InputIntent } from './Input';

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
}

export function createPlayer(x: number, y: number): PlayerState {
  return { x, y, prevX: x, prevY: y, vx: 0, vy: 0 };
}

/**
 * Move velocity (vx, vy) toward (tx, ty) by at most `maxDelta`, preserving the
 * direction of approach (so the ramp doesn't bias toward an axis). Returns
 * nothing — writes back through the player. Scalar-only, no allocation.
 */
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

/**
 * Advance the player by one fixed timestep against `room`. Snapshots the
 * previous position, ramps velocity toward the input target, then integrates
 * with axis-separated collision (stops clean against walls, slides along them).
 */
export function updatePlayer(
  player: PlayerState,
  intent: InputIntent,
  dt: number,
  room: RoomState,
): void {
  // Snapshot for render interpolation BEFORE moving.
  player.prevX = player.x;
  player.prevY = player.y;

  // Target velocity = normalized input × maxSpeed (diagonals not faster).
  // Normalization is inlined with scalars so the hot loop allocates nothing.
  const ix = intent.moveX;
  const iy = intent.moveY;
  const len = Math.hypot(ix, iy);
  const hasInput = len > 0;
  const targetVx = hasInput ? (ix / len) * TUNING.maxSpeed : 0;
  const targetVy = hasInput ? (iy / len) * TUNING.maxSpeed : 0;

  // Accelerate toward the target when there's input; brake toward rest otherwise.
  const rate = hasInput ? TUNING.accel : TUNING.friction;
  approachVelocity(player, targetVx, targetVy, rate * dt);

  // Integrate one axis at a time so movement slides along walls instead of
  // sticking. Zero the velocity on the axis that hit a wall.
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
