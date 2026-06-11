import { describe, expect, it } from 'vitest';
import { createGameState, update, nextFloorSeed, startNewRun, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { DESCENT, PLAYER_COMBAT, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/**
 * Clear the whole floor, resolving room `lastIdx` LAST through the real encounter
 * path so the stairs are PLACED (Phase 8: pinned to the BOSS room, not lastIdx).
 * All other rooms are marked cleared directly; `lastIdx` is set `active` with no
 * live enemies, so the next `update` resolves it -> places stairs (at the boss
 * room) + flips stairs.active. The player is parked at spawn (away from the
 * stairs) so it activates without descending.
 */
function clearFloor(s: GameState, lastIdx = 1): void {
  for (let i = 0; i < s.rooms.length; i++) {
    s.rooms[i].phase = i === lastIdx ? 'active' : 'cleared';
  }
  s.activeRoom = lastIdx;
  // The active room is SEALED (a real active room has its doors locked) — so the
  // deactivate-on-leave guard (which reverts an UNSEALED active room the player has
  // left) does not fire on this synthetic "about to resolve" state with the player
  // parked at spawn. Resolve then clears the (enemy-less) room as the test intends.
  for (const c of s.rooms[lastIdx].doorCells) s.room.solid[c.ty * s.room.tilesX + c.tx] = true;
  s.bossDefeated = true; // Phase 8: the boss is the descent gate (simulate the kill)
  s.player.x = s.spawn.x;
  s.player.y = s.spawn.y;
  update(s, idle(), DT);
}

/** Teleport the player onto the placed stairs position. */
function standOnStairs(s: GameState): void {
  s.player.x = s.stairs.x;
  s.player.y = s.stairs.y;
}

/** Centre (world units) of encounter room `i`. */
function roomCenter(s: GameState, i: number): { x: number; y: number } {
  const r = s.rooms[i].rect;
  return { x: (r.x + r.w / 2) * s.room.tileSize, y: (r.y + r.h / 2) * s.room.tileSize };
}

describe('Descent — stairs are PINNED to the boss room (Phase 8)', () => {
  it('on a fresh floor the stairs are unplaced (no room cleared yet)', () => {
    const s = createGameState();
    expect(s.stairs.roomIndex).toBe(-1);
    expect(s.stairs.active).toBe(false);
  });

  it('stairs land in the BOSS room (at its centre), whichever room clears last', () => {
    const s = createGameState();
    clearFloor(s, 2); // resolve a NON-boss room last...
    expect(s.stairs.roomIndex).toBe(s.bossRoom); // ...stairs still pin to the boss room
    const c = roomCenter(s, s.bossRoom);
    expect(s.stairs.x).toBeCloseTo(c.x, 9);
    expect(s.stairs.y).toBeCloseTo(c.y, 9);
    expect(s.stairs.active).toBe(true);
  });

  it('is path-INDEPENDENT: a different last-cleared room => SAME (boss-room) stairs', () => {
    const a = createGameState();
    const b = createGameState(); // same seed/floor as `a`
    clearFloor(a, 1);
    clearFloor(b, 3);
    expect(a.stairs.roomIndex).toBe(a.bossRoom);
    expect(b.stairs.roomIndex).toBe(b.bossRoom);
    expect(a.stairs.roomIndex).toBe(b.stairs.roomIndex); // same floor => same boss room
  });
});

describe('Descent — BOSS-DEATH gate (Phase 8)', () => {
  it('stairs stay inactive while the boss is alive (bossDefeated false at floor start)', () => {
    const s = createGameState();
    update(s, idle(), DT);
    expect(s.bossDefeated).toBe(false);
    expect(s.stairs.active).toBe(false);
  });

  it('stairs activate once the boss is dead (player away from them)', () => {
    const s = createGameState();
    clearFloor(s, 1); // marks rooms cleared AND sets bossDefeated (the kill)
    expect(s.stairs.active).toBe(true);
    expect(s.run.depth).toBe(1); // activating is not descending
  });

  it('clearing every NON-boss room does NOT unlock stairs while the boss lives', () => {
    const s = createGameState();
    // All non-boss rooms cleared, but the boss was never spawned/killed.
    for (let i = 0; i < s.rooms.length; i++) if (i !== s.bossRoom) s.rooms[i].phase = 'cleared';
    s.activeRoom = -1;
    update(s, idle(), DT);
    expect(s.bossDefeated).toBe(false);
    expect(s.stairs.active).toBe(false); // the boss is the gate, not all-cleared
  });
});

/** Place the player on a guaranteed ROOM-BODY (non-corridor) cell of room `i`. */
function placeInRoom(s: GameState, i: number): void {
  const r = s.rooms[i].rect;
  const room = s.room;
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (room.corridor?.[ty * room.tilesX + tx]) continue;
      s.player.x = (tx + 0.5) * room.tileSize;
      s.player.y = (ty + 0.5) * room.tileSize;
      return;
    }
  }
  s.player.x = (r.x + r.w / 2) * room.tileSize;
  s.player.y = (r.y + r.h / 2) * room.tileSize;
}

describe('Descent — boss death unlocks stairs with side rooms UNCLEARED (the fix)', () => {
  it('killing the boss activates the stairs even though a side room was never entered', () => {
    const s = createGameState();
    const bossRoom = s.bossRoom;

    // Activate the boss room (spawns the boss) via the real encounter path. Every
    // OTHER non-spawn room is left IDLE (un-entered) — the spanning-tree scenario.
    placeInRoom(s, bossRoom);
    update(s, idle(), DT);
    expect(s.boss).not.toBeNull();
    const idleSide = s.rooms.findIndex((r, i) => i !== bossRoom && r.phase === 'idle');
    expect(idleSide).toBeGreaterThan(0); // a non-boss room is still un-entered

    // Kill the boss; park the player at spawn so the clear frame doesn't descend.
    s.enemies[s.boss!.slot].active = false;
    s.player.x = s.spawn.x;
    s.player.y = s.spawn.y;
    update(s, idle(), DT);

    expect(s.bossDefeated).toBe(true);
    expect(s.stairs.active).toBe(true); // UNLOCKED despite the idle side room (was the bug)
    expect(s.rooms[idleSide].phase).toBe('idle'); // the side room is still un-cleared
    expect(s.stairs.roomIndex).toBe(bossRoom); // stairs pinned to the boss room
    expect(s.rooms.some((r) => r.phase !== 'cleared')).toBe(true); // NOT all-cleared

    // Drain the brief boss-death celebration hit-stop before stepping on the stairs.
    while (s.hitstopTimer > 0) update(s, idle(), DT);
    // And stepping on the (boss-room) stairs descends.
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    update(s, idle(), DT);
    expect(s.run.depth).toBe(2);
  });

  it('bossDefeated resets on the next floor (each floor needs its own boss killed)', () => {
    const s = createGameState();
    clearFloor(s, 1); // boss killed on floor 1
    expect(s.stairs.active).toBe(true);
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    update(s, idle(), DT); // descend -> loadFloor
    expect(s.run.depth).toBe(2);
    expect(s.bossDefeated).toBe(false); // fresh floor: its boss is alive again
    expect(s.stairs.active).toBe(false); // descent locked until the new boss dies
  });
});

describe('Descent — stepping on active stairs descends', () => {
  it('contact loads the next floor: depth+1, floorsCleared+1, deterministic new seed, rooms re-armed', () => {
    const s = createGameState();
    const seed0 = s.seed;
    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT);

    expect(s.run.depth).toBe(2);
    expect(s.run.floorsCleared).toBe(1);
    expect(s.seed).toBe(nextFloorSeed(seed0, 2));
    // New floor re-armed: spawn cleared, the rest idle; stairs reset (unplaced).
    expect(s.rooms[0].phase).toBe('cleared');
    expect(s.rooms.slice(1).every((r) => r.phase === 'idle')).toBe(true);
    expect(s.stairs.active).toBe(false);
    expect(s.stairs.roomIndex).toBe(-1);
    // Player is at the new floor's spawn.
    expect(s.player.x).toBeCloseTo(s.spawn.x, 9);
    expect(s.player.y).toBeCloseTo(s.spawn.y, 9);
  });

  it('does not descend while the stairs are inactive (floor not cleared)', () => {
    const s = createGameState();
    // Even sitting at the origin (the unplaced stairs coord), no descent.
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    update(s, idle(), DT);
    expect(s.stairs.active).toBe(false);
    expect(s.run.depth).toBe(1);
    expect(s.seed).toBe(createGameState().seed); // unchanged floor
  });

  it('descending twice accumulates run state (depth 1 -> 3, floorsCleared 2)', () => {
    const s = createGameState();
    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 2 (new floor)
    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 3 (new floor)
    expect(s.run.depth).toBe(3);
    expect(s.run.floorsCleared).toBe(2);
  });
});

describe('Descent — the build COMPOUNDS across floors', () => {
  it('descent preserves both powerups + current health (no refill, no reset)', () => {
    const s = createGameState();
    // Build up a within-run state on floor 1 (Phase 9: powerup LEVELS).
    s.player.pierceLevel = 2;
    s.player.knockbackLevel = 1;
    s.player.lifestealLevel = 2; // synergy arc: the effect axes carry like the tracks
    s.player.critLevel = 3;
    s.player.health = 50; // hurt, below max — must NOT be refilled by descending
    expect(s.player.health).toBeLessThan(PLAYER_COMBAT.maxHealth);

    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // DESCEND to floor 2

    expect(s.run.depth).toBe(2); // confirm we actually descended
    expect(s.player.pierceLevel).toBe(2); // carried (level, not reset)
    expect(s.player.knockbackLevel).toBe(1); // carried
    expect(s.player.lifestealLevel).toBe(2); // carried
    expect(s.player.critLevel).toBe(3); // carried (the finale axis)
    expect(s.player.health).toBe(50); // carried verbatim — NOT refilled, NOT reset
  });

  it('the build keeps compounding across multiple descents', () => {
    const s = createGameState();
    s.player.pierceLevel = 3;
    s.player.health = 40;

    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 2
    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 3

    expect(s.run.depth).toBe(3);
    expect(s.player.pierceLevel).toBe(3); // still carried two floors down
    expect(s.player.health).toBe(40); // still the carried value
  });

  it('a NEW run fully resets the player (toggles off, health full)', () => {
    const s = createGameState();
    s.player.pierceLevel = 2;
    s.player.knockbackLevel = 3;
    s.player.lifestealLevel = 3;
    s.player.health = 50;

    startNewRun(s, 4242);

    expect(s.run.depth).toBe(1);
    expect(s.player.pierceLevel).toBe(0); // reset
    expect(s.player.knockbackLevel).toBe(0); // reset
    expect(s.player.lifestealLevel).toBe(0); // reset (death clears the effect axis too)
    expect(s.player.health).toBe(PLAYER_COMBAT.maxHealth); // refilled
  });
});

describe('Descent — seed derivation', () => {
  it('nextFloorSeed is deterministic and 32-bit', () => {
    const a = nextFloorSeed(1, 2);
    const b = nextFloorSeed(1, 2);
    expect(a).toBe(b);
    expect(a).toBe((1 + Math.imul(DESCENT.seedStride, 2)) >>> 0);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
    // Different depth -> different next floor.
    expect(nextFloorSeed(1, 2)).not.toBe(nextFloorSeed(1, 3));
  });
});
