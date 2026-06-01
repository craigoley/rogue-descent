/**
 * The pure game-state container and its single `update` entry point.
 *
 * Heart of the pure layer: owns the player and the room, and advances them by a
 * fixed timestep. Imports NOTHING from three and never touches the DOM, so the
 * whole simulation runs and is unit-tested in Node. The rendering layer READS a
 * GameState; it must never mutate one.
 */

import { createPlayer, updatePlayer, type PlayerState } from './Player';
import { buildTestRoom, roomCenter, type RoomState } from './Room';
import type { InputIntent } from './Input';

export interface GameState {
  player: PlayerState;
  room: RoomState;
  /** Seconds elapsed since the run began. */
  time: number;
}

export function createGameState(): GameState {
  const room = buildTestRoom();
  const c = roomCenter(room);
  return { player: createPlayer(c.x, c.y), room, time: 0 };
}

/**
 * Advance the whole simulation by one fixed `dt`. The ONLY mutation path:
 * gather intent -> update(state, intent, dt) -> render. Mutates in place. Wall
 * collision (stop + slide) is handled inside updatePlayer against state.room.
 */
export function update(state: GameState, intent: InputIntent, dt: number): void {
  state.time += dt;
  updatePlayer(state.player, intent, dt, state.room);
}
