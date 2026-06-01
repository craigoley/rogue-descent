/**
 * Pure room data. Built ONCE from the hand-authored TEST_ROOM layout in
 * constants.ts (Phase 1 uses a fixed room so the feel test isn't confounded by
 * a random layout — the procedural generator is Phase 3). ZERO three/DOM.
 *
 * Walls are exposed two ways: `walls` (a list, for the renderer to build one
 * box per tile) and `solid` (a flat row-major boolean grid, for O(1) collision
 * lookup). Both are built at construction — nothing here allocates per frame.
 */

import { ROOM, TEST_ROOM } from '../utils/constants';

/** A wall cell, addressed by integer tile coordinates. */
export interface WallTile {
  tx: number;
  ty: number;
}

/** The static room layout the renderer draws and the player collides against. */
export interface RoomState {
  /** Width in tiles. */
  tilesX: number;
  /** Depth in tiles. */
  tilesY: number;
  /** Edge length of a tile, world units. */
  tileSize: number;
  /** Solid (wall) tiles, for rendering. */
  walls: WallTile[];
  /** Row-major solidity grid (length tilesX*tilesY) for O(1) collision tests. */
  solid: boolean[];
}

/** Parse the hand-authored layout into a RoomState. Deterministic. */
export function buildTestRoom(): RoomState {
  const rows = TEST_ROOM;
  const tilesY = rows.length;
  const tilesX = rows[0].length;
  const walls: WallTile[] = [];
  const solid: boolean[] = new Array<boolean>(tilesX * tilesY).fill(false);

  for (let ty = 0; ty < tilesY; ty++) {
    const row = rows[ty];
    for (let tx = 0; tx < tilesX; tx++) {
      if (row[tx] === '#') {
        solid[ty * tilesX + tx] = true;
        walls.push({ tx, ty });
      }
    }
  }

  return { tilesX, tilesY, tileSize: ROOM.tileSize, walls, solid };
}

/** Is tile (tx, ty) solid? Out-of-bounds counts as solid so the player can
 *  never leave the room even if a wall ring is missing. */
export function isSolid(room: RoomState, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= room.tilesX || ty >= room.tilesY) return true;
  return room.solid[ty * room.tilesX + tx];
}

/** World-space centre of the room, world units. Convenient spawn / camera init. */
export function roomCenter(room: RoomState): { x: number; y: number } {
  return {
    x: (room.tilesX * room.tileSize) / 2,
    y: (room.tilesY * room.tileSize) / 2,
  };
}
