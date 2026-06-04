/**
 * Pure axis-separated tilemap collision. The player is an axis-aligned box of
 * half-extent `r`. Movement is resolved one axis at a time: resolve the X move
 * against walls, THEN resolve the Y move against walls. That separation is what
 * produces SLIDING — pushing diagonally into a wall blocks the into-wall axis
 * while the along-wall axis keeps moving, instead of sticking.
 *
 * Functions take and return scalars (no objects) so the hot loop allocates
 * nothing. At Phase 1 speeds (maxSpeed/60 ≈ 0.12 world units per step, well
 * under one tile) tunnelling can't happen, so a single resolve per axis is
 * enough; a swept check can come later if speeds rise.
 */

import { isSolid, type RoomState } from './Room';

/**
 * Small inset so a box edge that sits EXACTLY on a tile boundary is treated as
 * a half-open interval (it does not count as overlapping the next tile). Without
 * this, a player flush against a wall (edge at x = N.0, floor(N.0) = N) would
 * see the wall tile in its PERPENDICULAR span and refuse to slide along it —
 * the classic corner-stick. Far smaller than a tile, far larger than the
 * floating-point error from the flush-clamp arithmetic.
 */
const EDGE_EPS = 1e-6;

/**
 * Does the axis-aligned box centred at (x, y) with half-extent `r` overlap tile
 * (tx, ty)? Uses the SAME half-open EDGE_EPS span as the resolver, so "the box
 * overlaps this tile" matches exactly what columnBlocks/rowBlocks treat as
 * blocking — i.e. the cells where making the tile solid would EMBED the box.
 * (Used by door-locking to skip cells the player occupies; see Encounter.) `ts`
 * is the tile size.
 */
export function boxOverlapsTile(x: number, y: number, r: number, tx: number, ty: number, ts: number): boolean {
  const txMin = Math.floor((x - r + EDGE_EPS) / ts);
  const txMax = Math.floor((x + r - EDGE_EPS) / ts);
  const tyMin = Math.floor((y - r + EDGE_EPS) / ts);
  const tyMax = Math.floor((y + r - EDGE_EPS) / ts);
  return tx >= txMin && tx <= txMax && ty >= tyMin && ty <= tyMax;
}

/** Any solid tile in column `col` overlapping the box's Y-extent [y-r, y+r]?
 *  Half-open: an edge flush on a tile boundary does not count as the next tile. */
function columnBlocks(room: RoomState, col: number, y: number, r: number): boolean {
  const ts = room.tileSize;
  const tyMin = Math.floor((y - r + EDGE_EPS) / ts);
  const tyMax = Math.floor((y + r - EDGE_EPS) / ts);
  for (let ty = tyMin; ty <= tyMax; ty++) {
    if (isSolid(room, col, ty)) return true;
  }
  return false;
}

/** Any solid tile in row `row` overlapping the box's X-extent [x-r, x+r]?
 *  Half-open: an edge flush on a tile boundary does not count as the next tile. */
function rowBlocks(room: RoomState, row: number, x: number, r: number): boolean {
  const ts = room.tileSize;
  const txMin = Math.floor((x - r + EDGE_EPS) / ts);
  const txMax = Math.floor((x + r - EDGE_EPS) / ts);
  for (let tx = txMin; tx <= txMax; tx++) {
    if (isSolid(room, tx, row)) return true;
  }
  return false;
}

/**
 * Resolve a move along X from `x` by `dx` (perpendicular position `y`). Returns
 * the resolved X — equal to `x + dx` when unobstructed, or flush against the
 * blocking wall face when not. Compare the result to `x + dx` to detect a hit.
 */
export function resolveX(x: number, y: number, dx: number, r: number, room: RoomState): number {
  const ts = room.tileSize;
  let nx = x + dx;
  if (dx > 0) {
    const col = Math.floor((nx + r) / ts);
    if (columnBlocks(room, col, y, r)) nx = col * ts - r;
  } else if (dx < 0) {
    const col = Math.floor((nx - r) / ts);
    if (columnBlocks(room, col, y, r)) nx = (col + 1) * ts + r;
  }
  return nx;
}

/**
 * Resolve a move along Y from `y` by `dy` (perpendicular position `x`). Returns
 * the resolved Y — equal to `y + dy` when unobstructed, or flush against the
 * blocking wall face when not.
 */
export function resolveY(x: number, y: number, dy: number, r: number, room: RoomState): number {
  const ts = room.tileSize;
  let ny = y + dy;
  if (dy > 0) {
    const row = Math.floor((ny + r) / ts);
    if (rowBlocks(room, row, x, r)) ny = row * ts - r;
  } else if (dy < 0) {
    const row = Math.floor((ny - r) / ts);
    if (rowBlocks(room, row, x, r)) ny = (row + 1) * ts + r;
  }
  return ny;
}
