/**
 * The pure game-state container and its single `update` entry point.
 *
 * Heart of the pure layer: owns the player and the one procedurally-built room,
 * and advances them by a fixed timestep. Imports NOTHING from three and never
 * touches the DOM, so the whole simulation runs and is unit-tested in Node. The
 * rendering layer READS a GameState; it must never mutate one.
 *
 * The richer dungeon generator (multiple rooms, corridors, props) arrives in a
 * later phase — this room is intentionally a single rectangle so the render
 * pipeline can be proven end-to-end first.
 */

import { ROOM } from '../utils/constants';
import { PLAYER } from '../utils/constants';
import { createPlayer, updatePlayer, type PlayerState } from './Player';
import type { InputIntent } from './Input';

/** A wall cell, addressed by integer tile coordinates. */
export interface WallTile {
  tx: number;
  ty: number;
}

/** The static room layout the renderer draws and the player is bounded by. */
export interface RoomState {
  /** Width in tiles. */
  tilesX: number;
  /** Depth in tiles. */
  tilesY: number;
  /** Edge length of a tile, world units. */
  tileSize: number;
  /** Perimeter wall tiles. */
  walls: WallTile[];
}

export interface GameState {
  player: PlayerState;
  room: RoomState;
  /** Seconds elapsed since the run began. */
  time: number;
}

/**
 * Build the single placeholder room: a solid rectangle of floor ringed by a
 * one-tile-thick perimeter wall. Deterministic, so renders and tests agree.
 */
export function generateRoom(): RoomState {
  const { tilesX, tilesY, tileSize } = ROOM;
  const walls: WallTile[] = [];
  for (let tx = 0; tx < tilesX; tx++) {
    for (let ty = 0; ty < tilesY; ty++) {
      const onEdge = tx === 0 || ty === 0 || tx === tilesX - 1 || ty === tilesY - 1;
      if (onEdge) walls.push({ tx, ty });
    }
  }
  return { tilesX, tilesY, tileSize, walls };
}

/** Playable interior bounds (world units) — the floor inset by the wall ring
 *  and the player radius, so the body never overlaps a wall. */
export function playableBounds(room: RoomState): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const margin = room.tileSize + PLAYER.radius;
  return {
    minX: margin,
    maxX: room.tilesX * room.tileSize - margin,
    minY: margin,
    maxY: room.tilesY * room.tileSize - margin,
  };
}

export function createGameState(): GameState {
  const room = generateRoom();
  // Start the player at the centre of the floor.
  const cx = (room.tilesX * room.tileSize) / 2;
  const cy = (room.tilesY * room.tileSize) / 2;
  return { player: createPlayer(cx, cy), room, time: 0 };
}

/**
 * Advance the whole simulation by `dt` seconds. The ONLY mutation path: gather
 * intent -> update(state, intent, dt) -> render. Mutates in place.
 */
export function update(state: GameState, intent: InputIntent, dt: number): void {
  state.time += dt;
  updatePlayer(state.player, intent, dt, playableBounds(state.room));
}
