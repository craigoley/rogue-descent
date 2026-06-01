/**
 * Pure player state and its update step. ZERO three.js / DOM imports — this is
 * the canonical "player moves via state, never via the render loop" rule the
 * whole project is built on. `updatePlayer` mutates in place (the only mutation
 * path) so no per-frame allocation happens in the loop.
 */

import { clamp, normalize } from '../utils/math';
import { PLAYER } from '../utils/constants';
import type { InputIntent } from './Input';

export interface PlayerState {
  /** World x (left/right), in world units. */
  x: number;
  /** World y (near/far depth), in world units. */
  y: number;
}

export function createPlayer(x: number, y: number): PlayerState {
  return { x, y };
}

/**
 * Advance the player by one timestep. Input is normalized so diagonal movement
 * is the same speed as cardinal movement, then position is clamped to the
 * playable bounds (room interior minus the player radius), passed in by the
 * caller so this stays free of room/layout knowledge.
 */
export function updatePlayer(
  player: PlayerState,
  intent: InputIntent,
  dt: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): void {
  const dir = normalize(intent.moveX, intent.moveY);
  player.x = clamp(player.x + dir.x * PLAYER.speed * dt, bounds.minX, bounds.maxX);
  player.y = clamp(player.y + dir.y * PLAYER.speed * dt, bounds.minY, bounds.maxY);
}
