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

import { ENCOUNTER, ROOM } from '../utils/constants';
import type { Rng } from '../utils/rng';
import { activeEnemyCount, spawnEnemy } from './Enemy';
import { rollDrop, spawnPickup } from './Pickup';
import type { Floor, Rect } from './Dungeon';
import type { RoomState } from './Room';
import type { GameState } from './GameState';

export type RoomPhase = 'idle' | 'active' | 'cleared';

export interface RoomEncounter {
  rect: Rect;
  phase: RoomPhase;
  /** Enemy spawn positions (world units) used when the room activates. */
  spawns: { x: number; y: number }[];
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

/** Enemy spawn positions: a small ring around the room centre (deterministic,
 *  inside the room since rooms are >= minRoom tiles). */
function computeSpawns(rect: Rect): { x: number; y: number }[] {
  const cx = (rect.x + rect.w / 2) * ROOM.tileSize;
  const cy = (rect.y + rect.h / 2) * ROOM.tileSize;
  const n = ENCOUNTER.enemiesPerRoom;
  const spread = ENCOUNTER.spawnSpread;
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(ang) * spread, y: cy + Math.sin(ang) * spread });
  }
  return out;
}

/** Build the encounter table for a floor. Room 0 (spawn) starts cleared (safe). */
export function buildEncounters(floor: Floor): RoomEncounter[] {
  return floor.rooms.map((rect, i) => ({
    rect,
    phase: i === 0 ? ('cleared' as RoomPhase) : ('idle' as RoomPhase),
    spawns: computeSpawns(rect),
    doorCells: computeDoorCells(floor.room, rect),
    dropsSpawned: 0,
    dropsCollected: 0,
  }));
}

function setDoors(state: GameState, enc: RoomEncounter, solid: boolean): void {
  const room = state.room;
  for (const c of enc.doorCells) room.solid[c.ty * room.tilesX + c.tx] = solid;
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
  const idx = playerRoomIndex(state);
  if (idx < 0) return;
  const enc = state.rooms[idx];
  if (enc.phase !== 'idle') return;
  enc.phase = 'active';
  state.activeRoom = idx;
  for (const s of enc.spawns) spawnEnemy(state.enemies, s.x, s.y);
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

/** Clear the active room once all its enemies are dead: unlock its doors. */
export function updateEncounterResolve(state: GameState): void {
  if (state.activeRoom < 0) return;
  const enc = state.rooms[state.activeRoom];
  if (enc.phase === 'active' && activeEnemyCount(state.enemies) === 0) {
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
