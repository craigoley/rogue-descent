/**
 * Deterministic BSP dungeon generator. PURE: ZERO three/DOM, no Math.random —
 * all randomness comes from the seeded Rng passed in, so the same seed yields a
 * byte-identical floor (see dungeon.test.ts).
 *
 * BSP gives connectivity BY CONSTRUCTION: the floor bounds are recursively split
 * into a binary tree; one room is carved per leaf; then, walking UP the tree,
 * each internal node carves an L-corridor between a room of its left subtree and
 * a room of its right subtree. The root therefore links its two halves and,
 * recursively, every room is reachable from every other — the property the
 * connectivity test pins across many seeds.
 *
 * Output is the SAME `RoomState` the existing Collision + DungeonRenderer already
 * consume: a `solid` grid (false = walkable room/corridor cell, true = wall) and
 * a `walls` list of the BORDER solid tiles (those touching a walkable cell) so
 * the renderer's box count stays bounded by perimeter, not floor area.
 */

import { DUNGEON, ROOM } from '../utils/constants';
import type { Rng } from '../utils/rng';
import { createRng } from '../utils/rng';
import type { RoomState, WallTile } from './Room';

/** Axis-aligned tile rectangle: (x, y) min corner, (w, h) size in tiles. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Floor {
  /** The collision/render contract object. */
  room: RoomState;
  /** The carved leaf rooms (DFS order); rooms[0] is the spawn room. */
  rooms: Rect[];
  /** Player spawn, world units (centre of the spawn room). */
  spawn: { x: number; y: number };
  /** The seed this floor was generated from. */
  seed: number;
}

interface Node {
  rect: Rect;
  left?: Node;
  right?: Node;
  room?: Rect;
}

const rectCenterTile = (r: Rect): { tx: number; ty: number } => ({
  tx: Math.floor(r.x + r.w / 2),
  ty: Math.floor(r.y + r.h / 2),
});

/** Recursively split a region into a BSP tree. */
function split(rect: Rect, depth: number, rng: Rng): Node {
  const node: Node = { rect };
  const { minLeaf, maxDepth, splitJitter } = DUNGEON;
  if (depth >= maxDepth) return node;

  // Can we split on each axis and leave both halves >= minLeaf?
  const canV = rect.w >= minLeaf * 2; // vertical cut (split width)
  const canH = rect.h >= minLeaf * 2; // horizontal cut (split height)
  if (!canV && !canH) return node;

  // Prefer splitting the longer axis; otherwise pick by chance.
  let vertical: boolean;
  if (canV && !canH) vertical = true;
  else if (canH && !canV) vertical = false;
  else if (rect.w / rect.h >= 1.25) vertical = true;
  else if (rect.h / rect.w >= 1.25) vertical = false;
  else vertical = rng.next() < 0.5;

  const length = vertical ? rect.w : rect.h;
  const frac = 0.5 + (rng.next() * 2 - 1) * splitJitter;
  // Keep both halves >= minLeaf.
  let cut = Math.round(length * frac);
  cut = Math.max(minLeaf, Math.min(length - minLeaf, cut));

  if (vertical) {
    node.left = split({ x: rect.x, y: rect.y, w: cut, h: rect.h }, depth + 1, rng);
    node.right = split({ x: rect.x + cut, y: rect.y, w: rect.w - cut, h: rect.h }, depth + 1, rng);
  } else {
    node.left = split({ x: rect.x, y: rect.y, w: rect.w, h: cut }, depth + 1, rng);
    node.right = split({ x: rect.x, y: rect.y + cut, w: rect.w, h: rect.h - cut }, depth + 1, rng);
  }
  return node;
}

/** Carve a room inside each leaf, collecting them in DFS order. */
function placeRooms(node: Node, rng: Rng, out: Rect[]): void {
  if (node.left || node.right) {
    if (node.left) placeRooms(node.left, rng, out);
    if (node.right) placeRooms(node.right, rng, out);
    return;
  }
  const { roomPadding, minRoom } = DUNGEON;
  const ax = node.rect.x + roomPadding;
  const ay = node.rect.y + roomPadding;
  const aw = node.rect.w - roomPadding * 2;
  const ah = node.rect.h - roomPadding * 2;
  const w = rng.int(minRoom, Math.max(minRoom, aw));
  const h = rng.int(minRoom, Math.max(minRoom, ah));
  const x = rng.int(ax, ax + Math.max(0, aw - w));
  const y = rng.int(ay, ay + Math.max(0, ah - h));
  const room: Rect = { x, y, w, h };
  node.room = room;
  out.push(room);
}

/** Mark a filled tile walkable, clamped to the interior so the outer ring stays
 *  solid (enclosing the floor). */
function carve(walkable: boolean[], tilesX: number, tilesY: number, tx: number, ty: number): void {
  if (tx < 1 || ty < 1 || tx >= tilesX - 1 || ty >= tilesY - 1) return;
  walkable[ty * tilesX + tx] = true;
}

function carveRoom(walkable: boolean[], tilesX: number, tilesY: number, r: Rect): void {
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) carve(walkable, tilesX, tilesY, tx, ty);
  }
}

/** Square brush so corridors have width and bends stay contiguous. */
function brush(walkable: boolean[], tilesX: number, tilesY: number, cx: number, cy: number): void {
  const w = DUNGEON.corridorWidth;
  const h0 = Math.floor((w - 1) / 2);
  const h1 = w - 1 - h0;
  for (let dy = -h0; dy <= h1; dy++) {
    for (let dx = -h0; dx <= h1; dx++) carve(walkable, tilesX, tilesY, cx + dx, cy + dy);
  }
}

/** L-shaped corridor (horizontal then vertical) between two tile centres. */
function carveCorridor(
  walkable: boolean[],
  tilesX: number,
  tilesY: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  for (let x = x0; x <= x1; x++) brush(walkable, tilesX, tilesY, x, ay);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  for (let y = y0; y <= y1; y++) brush(walkable, tilesX, tilesY, bx, y);
}

/** Walk up the tree connecting sibling subtrees; returns a representative room
 *  to propagate upward (connectivity by construction). */
function connect(
  node: Node,
  rng: Rng,
  walkable: boolean[],
  tilesX: number,
  tilesY: number,
): Rect {
  if (node.room) return node.room;
  const a = connect(node.left!, rng, walkable, tilesX, tilesY);
  const b = connect(node.right!, rng, walkable, tilesX, tilesY);
  const ca = rectCenterTile(a);
  const cb = rectCenterTile(b);
  carveCorridor(walkable, tilesX, tilesY, ca.tx, ca.ty, cb.tx, cb.ty);
  return rng.next() < 0.5 ? a : b;
}

/** Generate a connected multi-room floor from `seed`. */
export function generateDungeon(seed: number): Floor {
  const { tilesX, tilesY } = DUNGEON;
  const rng = createRng(seed);

  const root = split({ x: 0, y: 0, w: tilesX, h: tilesY }, 0, rng);
  const rooms: Rect[] = [];
  placeRooms(root, rng, rooms);

  const walkable = new Array<boolean>(tilesX * tilesY).fill(false);
  for (const r of rooms) carveRoom(walkable, tilesX, tilesY, r);
  connect(root, rng, walkable, tilesX, tilesY);

  // Build the contract: solid = !walkable; walls = border solid tiles only.
  const solid = new Array<boolean>(tilesX * tilesY);
  const walls: WallTile[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const i = ty * tilesX + tx;
      const isWall = !walkable[i];
      solid[i] = isWall;
      if (isWall && bordersWalkable(walkable, tilesX, tilesY, tx, ty)) {
        walls.push({ tx, ty });
      }
    }
  }

  const room: RoomState = { tilesX, tilesY, tileSize: ROOM.tileSize, walls, solid };
  const spawnRoom = rooms[0];
  const spawn = {
    x: (spawnRoom.x + spawnRoom.w / 2) * ROOM.tileSize,
    y: (spawnRoom.y + spawnRoom.h / 2) * ROOM.tileSize,
  };
  return { room, rooms, spawn, seed };
}

/** True if any 8-neighbour of (tx, ty) is walkable (so this wall is a visible
 *  border, worth a render box). */
function bordersWalkable(
  walkable: boolean[],
  tilesX: number,
  tilesY: number,
  tx: number,
  ty: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= tilesX || ny >= tilesY) continue;
      if (walkable[ny * tilesX + nx]) return true;
    }
  }
  return false;
}

/**
 * Index of the room whose centre is FARTHEST (Euclidean) from the spawn room
 * (rooms[0]) — where the descent stairs go, so the player must traverse the
 * floor to descend. Rooms are emitted in BSP DFS order, which is NOT a distance
 * order, so this must be computed, never assumed to be the last index. Squared
 * distance (no sqrt); strict `>` breaks ties toward the lowest index, so the
 * result is deterministic for a given seed.
 */
export function farthestRoomIndex(floor: Floor): number {
  const ts = floor.room.tileSize;
  const sx = floor.spawn.x;
  const sy = floor.spawn.y;
  let best = 0;
  let bestD = -1;
  for (let i = 0; i < floor.rooms.length; i++) {
    const r = floor.rooms[i];
    const cx = (r.x + r.w / 2) * ts;
    const cy = (r.y + r.h / 2) * ts;
    const d = (cx - sx) ** 2 + (cy - sy) ** 2;
    if (d > bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Connectivity check (pure): BFS over walkable cells from the spawn room centre;
 * returns true iff every room's centre tile is reached. The load-bearing
 * correctness property — a disconnected floor is unplayable.
 */
export function isConnected(floor: Floor): boolean {
  const { tilesX, tilesY, solid } = floor.room;
  const seen = new Array<boolean>(tilesX * tilesY).fill(false);
  const start = rectCenterTile(floor.rooms[0]);
  const queue: number[] = [start.ty * tilesX + start.tx];
  seen[queue[0]] = true;
  // BFS via an index cursor (no per-step array shifting).
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const tx = i % tilesX;
    const ty = (i - tx) / tilesX;
    const neighbours = [
      [tx + 1, ty],
      [tx - 1, ty],
      [tx, ty + 1],
      [tx, ty - 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= tilesX || ny >= tilesY) continue;
      const ni = ny * tilesX + nx;
      if (seen[ni] || solid[ni]) continue;
      seen[ni] = true;
      queue.push(ni);
    }
  }
  return floor.rooms.every((r) => {
    const c = rectCenterTile(r);
    return seen[c.ty * tilesX + c.tx];
  });
}
