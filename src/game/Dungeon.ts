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

import { CHEST, DUNGEON, ROOM } from '../utils/constants';
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
  /** Index into rooms[] of the BOSS room (Phase 8): the room reached LAST = max
   *  corridor-hop distance from spawn over the carved corridor spanning tree.
   *  Additive — does not affect the carved layout. */
  bossRoom: number;
  /** Indices into rooms[] that hold a GOLDEN CHEST (1-2; never the spawn room 0 nor
   *  the boss room). Picked from the layout rng AFTER carving, so it's additive —
   *  the rooms/corridors/walls are byte-identical with or without chests. */
  chestRooms: number[];
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

/** True if tile (tx, ty) lies inside a room that is NOT one of this corridor's
 *  two endpoints — i.e. a room the corridor is merely PASSING THROUGH. Those
 *  cells get the corridor tag so a pass-through can't spuriously activate the
 *  room; an endpoint room's OWN entry corridor (incl. the strip to its centre)
 *  is left untagged so genuine entry still activates. */
function isForeignRoomCell(
  rooms: Rect[],
  ea: Rect,
  eb: Rect,
  tx: number,
  ty: number,
): boolean {
  for (const r of rooms) {
    if (r === ea || r === eb) continue; // endpoint room: own-entry corridor, not foreign
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return true;
  }
  return false;
}

/** Square brush so corridors have width and bends stay contiguous. Carves
 *  walkable, and tags as CORRIDOR only cells inside a FOREIGN room (one this
 *  corridor isn't connecting) — the pass-through strips. */
function brush(
  walkable: boolean[],
  corridor: boolean[],
  rooms: Rect[],
  ea: Rect,
  eb: Rect,
  tilesX: number,
  tilesY: number,
  cx: number,
  cy: number,
): void {
  const w = DUNGEON.corridorWidth;
  const h0 = Math.floor((w - 1) / 2);
  const h1 = w - 1 - h0;
  for (let dy = -h0; dy <= h1; dy++) {
    for (let dx = -h0; dx <= h1; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 1 || ty < 1 || tx >= tilesX - 1 || ty >= tilesY - 1) continue;
      walkable[ty * tilesX + tx] = true;
      if (isForeignRoomCell(rooms, ea, eb, tx, ty)) corridor[ty * tilesX + tx] = true;
    }
  }
}

/** L-shaped corridor (horizontal then vertical) between two room CENTRES. `ea`/
 *  `eb` are the endpoint rooms (so their own interiors aren't tagged corridor).
 *  Cells crossing any OTHER room's rect are tagged — see Encounter. */
function carveCorridor(
  walkable: boolean[],
  corridor: boolean[],
  rooms: Rect[],
  ea: Rect,
  eb: Rect,
  tilesX: number,
  tilesY: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  for (let x = x0; x <= x1; x++) brush(walkable, corridor, rooms, ea, eb, tilesX, tilesY, x, ay);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  for (let y = y0; y <= y1; y++) brush(walkable, corridor, rooms, ea, eb, tilesX, tilesY, bx, y);
}

/** Walk up the tree connecting sibling subtrees; returns a representative room
 *  to propagate upward (connectivity by construction). */
function connect(
  node: Node,
  rng: Rng,
  walkable: boolean[],
  corridor: boolean[],
  rooms: Rect[],
  edges: [number, number][],
  tilesX: number,
  tilesY: number,
): Rect {
  if (node.room) return node.room;
  const a = connect(node.left!, rng, walkable, corridor, rooms, edges, tilesX, tilesY);
  const b = connect(node.right!, rng, walkable, corridor, rooms, edges, tilesX, tilesY);
  const ca = rectCenterTile(a);
  const cb = rectCenterTile(b);
  // a/b are the connected rooms — their own interiors stay untagged; only OTHER
  // rooms the L-path crosses get the corridor (pass-through) tag.
  carveCorridor(walkable, corridor, rooms, a, b, tilesX, tilesY, ca.tx, ca.ty, cb.tx, cb.ty);
  // Record the corridor as a graph edge (the carved corridors form a spanning
  // TREE over the rooms) so we can pick the boss room by max hops from spawn.
  edges.push([rooms.indexOf(a), rooms.indexOf(b)]);
  return rng.next() < 0.5 ? a : b;
}

/** Designate the BOSS room: the room you reach LAST on a natural playthrough =
 *  the MAX corridor-hop distance from the spawn room (rooms[0]) over the carved
 *  corridor spanning tree (graph distance, NOT geometric — corridors connect
 *  rng-picked representatives, so a far-away room can be few hops). Ties → the
 *  LARGEST room (also helps it hold the big boss), then lowest index. Then a
 *  boss-FIT fallback: if the winner is too small for the boss radius, take the
 *  largest among the farthest band. Deterministic per seed. */
function pickBossRoom(rooms: Rect[], edges: [number, number][]): number {
  const adj: number[][] = rooms.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  // BFS hop-distance from spawn (rooms[0]).
  const dist = rooms.map(() => -1);
  dist[0] = 0;
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    for (const v of adj[u]) {
      if (dist[v] === -1) {
        dist[v] = dist[u] + 1;
        queue.push(v);
      }
    }
  }
  const area = (r: Rect): number => r.w * r.h;
  // Boss must physically fit (radius + the room-rect clamp margin). Prefer the
  // farthest; among equally-far, the largest; fall back to the largest room that
  // fits if the farthest is too small.
  const fits = (r: Rect): boolean =>
    Math.min(r.w, r.h) >= DUNGEON.bossMinRoomSide;
  let best = 0;
  let bestKey = -1; // sort key: dist (primary), then area, then -index
  for (let i = 1; i < rooms.length; i++) {
    if (!fits(rooms[i])) continue;
    // pack (dist, area) into a comparable: dist dominates, area breaks ties.
    const key = dist[i] * 1e6 + area(rooms[i]);
    if (key > bestKey) {
      bestKey = key;
      best = i;
    }
  }
  // Fallback: if no room "fits" (shouldn't happen with minRoom 6), take the
  // farthest regardless.
  if (bestKey < 0) {
    let far = 0;
    for (let i = 1; i < rooms.length; i++) {
      if (dist[i] > dist[far] || (dist[i] === dist[far] && area(rooms[i]) > area(rooms[far]))) far = i;
    }
    best = far;
  }
  return best;
}

/** Generate a connected multi-room floor from `seed`. */
export function generateDungeon(seed: number): Floor {
  const { tilesX, tilesY } = DUNGEON;
  const rng = createRng(seed);

  const root = split({ x: 0, y: 0, w: tilesX, h: tilesY }, 0, rng);
  const rooms: Rect[] = [];
  placeRooms(root, rng, rooms);

  const walkable = new Array<boolean>(tilesX * tilesY).fill(false);
  // Parallel grid recording which walkable cells are CORRIDOR (set only by the
  // corridor brush, never carveRoom). A corridor carved THROUGH a room's rect
  // tags that strip, so the encounter layer can refuse to activate a room the
  // player is only PASSING THROUGH (see Encounter.updateEncounterEntry).
  const corridor = new Array<boolean>(tilesX * tilesY).fill(false);
  for (const r of rooms) carveRoom(walkable, tilesX, tilesY, r);
  const edges: [number, number][] = [];
  connect(root, rng, walkable, corridor, rooms, edges, tilesX, tilesY);
  const bossRoom = pickBossRoom(rooms, edges);
  // GOLDEN CHESTS: pick 1-2 chest rooms. Drawn from `rng` AFTER all carving is done
  // (rooms/corridors/walls are already built above), so it's purely additive — the
  // layout is byte-identical whether or not chests exist; only `rng`'s spent state
  // changes, which nothing downstream reads. Deterministic per seed.
  const chestRooms = pickChestRooms(rooms, bossRoom, rng);

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

  const room: RoomState = { tilesX, tilesY, tileSize: ROOM.tileSize, walls, solid, corridor };
  const spawnRoom = rooms[0];
  const spawn = {
    x: (spawnRoom.x + spawnRoom.w / 2) * ROOM.tileSize,
    y: (spawnRoom.y + spawnRoom.h / 2) * ROOM.tileSize,
  };
  return { room, rooms, spawn, seed, bossRoom, chestRooms };
}

/** Pick 1-2 GOLDEN-CHEST rooms: eligible = every room except the spawn (0) and the
 *  boss room. Deterministic per the (post-carve) rng; additive (carving is done).
 *  Returns sorted, distinct indices; [] if no room is eligible. */
function pickChestRooms(rooms: Rect[], bossRoom: number, rng: Rng): number[] {
  const eligible: number[] = [];
  for (let i = 1; i < rooms.length; i++) if (i !== bossRoom) eligible.push(i);
  if (eligible.length === 0) return [];
  const count = Math.min(eligible.length, rng.int(CHEST.minPerFloor, CHEST.maxPerFloor));
  // Partial Fisher-Yates: take the first `count` after shuffling the front.
  for (let i = 0; i < count; i++) {
    const j = rng.int(i, eligible.length - 1);
    const t = eligible[i];
    eligible[i] = eligible[j];
    eligible[j] = t;
  }
  return eligible.slice(0, count).sort((a, b) => a - b);
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
