/**
 * Per-room encounters + door-gating (Phase 5). PURE: ZERO three/DOM.
 *
 * Lifecycle: a room is `idle` until the player enters it, then `active` (its
 * enemies spawn from the shared pool and its doorways LOCK) until every enemy is
 * dead, then `cleared` (doorways unlock). The spawn room (index 0) starts
 * `cleared` so the player gets a safe start before the first gate.
 *
 * Gating reuses the existing wall collision: locking a door flips its corridor-
 * mouth cells to solid in room.solid (the same grid resolveX/Y read), so the
 * player is physically blocked with no new collision logic. Unlocking restores
 * them to walkable. Because the active room is sealed, at most one room is active
 * at a time — so "cleared = active room with zero live enemies".
 */

import { ENCOUNTER, PLAYER, ROOM, type EnemyType } from '../utils/constants';
import { enemiesPerRoomForDepth, rangedCountForDepth, swarmerCountForDepth } from './Difficulty';
import { boxOverlapsTile } from './Collision';
import type { Rng } from '../utils/rng';
import { roomEnemyCount, spawnEnemy } from './Enemy';
import { rollDrop, spawnPickup } from './Pickup';
import type { Floor, Rect } from './Dungeon';
import type { RoomState } from './Room';
import type { GameState } from './GameState';

export type RoomPhase = 'idle' | 'active' | 'cleared';

export interface RoomEncounter {
  rect: Rect;
  phase: RoomPhase;
  /** Enemy spawns (world-unit position + type) used when the room activates. */
  spawns: { x: number; y: number; type: EnemyType }[];
  /** Corridor-mouth cells (tile coords) that lock/unlock with the room. */
  doorCells: { tx: number; ty: number }[];
  dropsSpawned: number;
  dropsCollected: number;
}

/** Walkable cells in the 1-tile ring just outside the room rect — the corridor
 *  mouths to seal when the room is active. */
function computeDoorCells(room: RoomState, rect: Rect): { tx: number; ty: number }[] {
  const cells: { tx: number; ty: number }[] = [];
  for (let ty = rect.y - 1; ty <= rect.y + rect.h; ty++) {
    for (let tx = rect.x - 1; tx <= rect.x + rect.w; tx++) {
      const insideRect = tx >= rect.x && tx < rect.x + rect.w && ty >= rect.y && ty < rect.y + rect.h;
      if (insideRect) continue;
      if (tx < 0 || ty < 0 || tx >= room.tilesX || ty >= room.tilesY) continue;
      if (!room.solid[ty * room.tilesX + tx]) cells.push({ tx, ty }); // walkable mouth
    }
  }
  return cells;
}

/** Enemy spawns: a small ring around the room centre (deterministic, inside the
 *  room since rooms are >= minRoom tiles). The mix SUBSTITUTES specials for
 *  chasers within the per-depth count (no added density): slots fill CHASERS
 *  first [0, c), then RANGED, then SWARMERS — so the pool's leading slots are
 *  always chasers (keeps difficulty assertions on live[0] valid) and there's
 *  always >= 1 chaser. Deterministic by index — no RNG, same seed+depth => same
 *  mix. */
function computeSpawns(rect: Rect, depth: number): { x: number; y: number; type: EnemyType }[] {
  const cx = (rect.x + rect.w / 2) * ROOM.tileSize;
  const cy = (rect.y + rect.h / 2) * ROOM.tileSize;
  const n = enemiesPerRoomForDepth(depth); // depth-scaled count (Phase 7c)
  const ranged = rangedCountForDepth(depth); // SUBSTITUTE for chasers (7.5)
  const swarmer = swarmerCountForDepth(depth); // SUBSTITUTE for chasers (7.6)
  const chasers = n - ranged - swarmer; // >= 1 by the count clamps
  const spread = ENCOUNTER.spawnSpread;
  const out: { x: number; y: number; type: EnemyType }[] = [];
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2;
    let type: EnemyType;
    if (k < chasers) type = 'chaser';
    else if (k < chasers + ranged) type = 'ranged';
    else type = 'swarmer';
    out.push({ x: cx + Math.cos(ang) * spread, y: cy + Math.sin(ang) * spread, type });
  }
  return out;
}

/** Build the encounter table for a floor. Room 0 (spawn) starts cleared (safe). */
export function buildEncounters(floor: Floor, depth = 1): RoomEncounter[] {
  return floor.rooms.map((rect, i) => ({
    rect,
    phase: i === 0 ? ('cleared' as RoomPhase) : ('idle' as RoomPhase),
    spawns: computeSpawns(rect, depth),
    doorCells: computeDoorCells(floor.room, rect),
    dropsSpawned: 0,
    dropsCollected: 0,
  }));
}

/**
 * Lock (solid=true) or unlock (false) a room's doorway cells. LOCKING SKIPS any
 * cell the player's box currently overlaps — solidifying a cell under the player
 * would embed them and the single-resolve collision would eject them a full tile
 * per tick across the map (the door-lock runaway softlock). The skipped cells are
 * re-locked once the player steps off (see updateEncounterDoors), so the room
 * still seals. Unlocking never embeds, so it always applies to every cell.
 */
function setDoors(state: GameState, enc: RoomEncounter, solid: boolean): void {
  const room = state.room;
  const p = state.player;
  const r = PLAYER.radius;
  const ts = room.tileSize;
  for (const c of enc.doorCells) {
    if (solid && boxOverlapsTile(p.x, p.y, r, c.tx, c.ty, ts)) continue; // don't slam on the player
    room.solid[c.ty * room.tilesX + c.tx] = solid;
  }
}

/**
 * Per-frame seal maintenance: re-apply the (occupancy-aware) lock to the active
 * room's doorways. Idempotent — re-locking an already-solid cell is a no-op; a
 * cell deferred because the player stood on it gets locked the frame they vacate
 * it. So the seal completes ~1 tick after the player leaves the doorway, with no
 * new state to track (an unlocked door cell of the active room IS the pending
 * state). No-op when no room is active.
 */
export function updateEncounterDoors(state: GameState): void {
  if (state.activeRoom < 0) return;
  const enc = state.rooms[state.activeRoom];
  if (enc.phase === 'active') setDoors(state, enc, true);
}

/** Index of the encounter room containing the player, or -1 (corridor). */
export function playerRoomIndex(state: GameState): number {
  const ts = state.room.tileSize;
  const tx = Math.floor(state.player.x / ts);
  const ty = Math.floor(state.player.y / ts);
  for (let i = 0; i < state.rooms.length; i++) {
    const r = state.rooms[i].rect;
    if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return i;
  }
  return -1;
}

/** Activate the idle room the player just entered: spawn its enemies + lock. */
export function updateEncounterEntry(state: GameState): void {
  // ONE encounter at a time. activeRoom >= 0 iff a room is currently active (it's
  // freed to -1 only on clear / loadFloor), so this prevents a SECOND room from
  // activating while one is live — the double-activation softlock (6 enemies +
  // an orphaned, permanently-sealed room). Trigger-agnostic: even if the player's
  // centre crosses a foreign room rect (e.g. a corridor carved through a room),
  // no second encounter spawns. Can't deadlock — a room can always activate when
  // none is active.
  if (state.activeRoom >= 0) return;
  const idx = playerRoomIndex(state);
  if (idx < 0) return;
  const enc = state.rooms[idx];
  if (enc.phase !== 'idle') return; // still needed: don't re-activate a CLEARED room
  // Only activate from the room's BODY floor, not a corridor carved THROUGH its
  // rect — a player merely passing through (on the 2-wide corridor strip) must
  // not spuriously activate the room (spawn enemies + lock doors). The room body
  // is the rest of the rect, so genuine entry (incl. an endpoint/boss room, whose
  // corridor ends at its centre) still activates the moment the player steps onto
  // body floor. ?. keeps it backward-compatible: a room with no corridor grid
  // (hand-built test arenas) activates on plain rect-containment as before.
  const ts = state.room.tileSize;
  const tx = Math.floor(state.player.x / ts);
  const ty = Math.floor(state.player.y / ts);
  if (state.room.corridor?.[ty * state.room.tilesX + tx]) return;
  enc.phase = 'active';
  state.activeRoom = idx;
  // Tag each enemy with its owning room so the room clears on ITS OWN enemies.
  for (const s of enc.spawns) spawnEnemy(state.enemies, s.x, s.y, state.run.depth, s.type, idx);
  setDoors(state, enc, true);
}

/** Move the descent stairs into a room (its centre, world units). Called every
 *  time a room clears, so after the FINAL clear the stairs sit in the LAST-
 *  cleared room — where the player's momentum already is, so descent flows out
 *  of the final fight instead of a backtrack to a far room. Intermediate moves
 *  are invisible: GameState only flips stairs.active once every room is cleared. */
function placeStairs(state: GameState, roomIdx: number): void {
  const r = state.rooms[roomIdx].rect;
  const ts = state.room.tileSize;
  state.stairs.roomIndex = roomIdx;
  state.stairs.x = (r.x + r.w / 2) * ts;
  state.stairs.y = (r.y + r.h / 2) * ts;
}

/** Clear the active room once ITS OWN enemies are dead: unlock its doors. Counts
 *  only enemies tagged with the active room (roomEnemyCount), not the whole pool,
 *  so a foreign room's enemies can never keep the active room from clearing. */
export function updateEncounterResolve(state: GameState): void {
  if (state.activeRoom < 0) return;
  const enc = state.rooms[state.activeRoom];
  if (enc.phase === 'active' && roomEnemyCount(state.enemies, state.activeRoom) === 0) {
    const clearedIdx = state.activeRoom;
    enc.phase = 'cleared';
    setDoors(state, enc, false);
    state.activeRoom = -1;
    // Stairs follow the most-recently-cleared room; the final clear lands them
    // in the last-cleared room (the descent-flow fix).
    placeStairs(state, clearedIdx);
  }
}

/** Roll a drop at a slain enemy's position, attributing it to the active room. */
export function rollAndSpawnDrop(state: GameState, x: number, y: number, rng: Rng): void {
  const kind = rollDrop(rng);
  if (!kind) return;
  const room = state.activeRoom;
  if (spawnPickup(state.pickups, x, y, kind, room)) {
    state.dropCounts[kind]++; // ?debug funnel tally
    if (room >= 0) state.rooms[room].dropsSpawned++;
  }
}
