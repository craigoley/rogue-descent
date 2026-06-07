/**
 * L1 integration (batch 3) — SPAWN MIX BY DEPTH, end-to-end. difficulty.test pins
 * the COUNT functions (rangedCountForDepth / swarmerCountForDepth) in isolation;
 * nothing else asserts the full depth -> computeSpawns -> spawnEnemy -> enemy.type
 * path: that activating a real room at a given depth actually spawns the right
 * enemy TYPES. This bakes the spawn-mix GATES into a permanent guard.
 *
 * Verified counts (deterministic — computeSpawns has no RNG): enemies/room is 3
 * (d1-2) then 4 (d3-4); ranged opens at d>=3 (rangedMinDepth 3), swarmer at d>=4
 * (swarmerMinDepth 4). So a non-boss room holds: chasers only (d1/d2); chasers +
 * ranged, no swarmer (d3); chasers + ranged + swarmer (d4).
 *
 * Deterministic: fixed seed + scripted descents (the l1-depth-scaling descendOnce
 * pattern). Reuses the l1-harness helpers; src/game/ untouched.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startNewRun, update, type GameState } from '../GameState';
import { SIM_DT } from '../../utils/constants';
import { idle, placeInRoom } from './l1-harness';

const DT = SIM_DT;
const SEED = 73101;

/** Clear the floor + step onto the boss-gated stairs to descend exactly once (the
 *  established pattern: rooms cleared, boss flagged defeated -> stairs open). */
function descendOnce(s: GameState): void {
  for (let i = 0; i < s.rooms.length; i++) s.rooms[i].phase = i === 1 ? 'active' : 'cleared';
  s.activeRoom = 1;
  s.bossDefeated = true;
  s.player.x = s.spawn.x;
  s.player.y = s.spawn.y;
  update(s, idle(), DT); // resolve room 1 -> placeStairs(bossRoom) + stairs.active
  s.player.x = s.stairs.x;
  s.player.y = s.stairs.y;
  update(s, idle(), DT); // step on stairs -> descend (loadFloor)
}

/** A fresh run descended to `depth` (deterministic from SEED). */
function runAtDepth(depth: number): GameState {
  const s = createGameState();
  startNewRun(s, SEED);
  for (let d = 1; d < depth; d++) descendOnce(s);
  expect(s.run.depth).toBe(depth);
  return s;
}

/** Activate a NON-boss room (real encounter entry) and return the set of enemy
 *  TYPES it spawned. The boss room is excluded (it's boss-alone, no normal spawns). */
function activatedRoomTypes(s: GameState): Set<string> {
  const room = s.rooms.findIndex(
    (r, i) => i !== 0 && i !== s.bossRoom && r.phase === 'idle' && r.spawns.length > 0,
  );
  expect(room).toBeGreaterThan(0); // a normal spawning room exists
  placeInRoom(s, room);
  update(s, idle(), DT); // body-floor entry -> activate -> spawn the depth mix
  expect(s.rooms[room].phase).toBe('active');
  const types = new Set<string>();
  for (const e of s.enemies) if (e.active && e.roomIndex === room) types.add(e.type);
  return types;
}

describe('L1 integration: spawn mix gates by depth', () => {
  it('depth 1: a room spawns ONLY chasers (no ranged, no swarmer)', () => {
    const types = activatedRoomTypes(runAtDepth(1));
    expect(types.has('chaser')).toBe(true);
    expect(types.has('ranged')).toBe(false);
    expect(types.has('swarmer')).toBe(false);
  });

  it('depth 2: still chasers only (ranged gate is depth 3)', () => {
    const types = activatedRoomTypes(runAtDepth(2));
    expect(types.has('chaser')).toBe(true);
    expect(types.has('ranged')).toBe(false);
    expect(types.has('swarmer')).toBe(false);
  });

  it('depth 3: RANGED appears, swarmer still gated out', () => {
    const types = activatedRoomTypes(runAtDepth(3));
    expect(types.has('ranged')).toBe(true); // the ranged gate opened
    expect(types.has('swarmer')).toBe(false); // swarmer gate is depth 4
  });

  it('depth 4: SWARMER appears (alongside ranged)', () => {
    const types = activatedRoomTypes(runAtDepth(4));
    expect(types.has('swarmer')).toBe(true); // the swarmer gate opened
    expect(types.has('ranged')).toBe(true); // ranged still present
  });
});
