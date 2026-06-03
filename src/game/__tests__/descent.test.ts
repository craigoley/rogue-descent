import { describe, expect, it } from 'vitest';
import { createGameState, update, nextFloorSeed, startNewRun, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { DESCENT, PLAYER_COMBAT, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/**
 * Clear the whole floor, resolving room `lastIdx` LAST through the real encounter
 * path so the stairs are PLACED in it (mirrors play: stairs spawn in the last-
 * cleared room). All other rooms are marked cleared directly; `lastIdx` is set
 * `active` with no live enemies, so the next `update` resolves it -> places
 * stairs there + flips stairs.active. The player is parked at spawn (away from
 * the stairs) so it activates without descending.
 */
function clearFloor(s: GameState, lastIdx = 1): void {
  for (let i = 0; i < s.rooms.length; i++) {
    s.rooms[i].phase = i === lastIdx ? 'active' : 'cleared';
  }
  s.activeRoom = lastIdx;
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

describe('Descent — stairs go in the LAST-cleared room', () => {
  it('on a fresh floor the stairs are unplaced (no room cleared yet)', () => {
    const s = createGameState();
    expect(s.stairs.roomIndex).toBe(-1);
    expect(s.stairs.active).toBe(false);
  });

  it('the room that clears LAST becomes the stairs room (at its centre)', () => {
    const s = createGameState();
    const last = 2;
    clearFloor(s, last);
    expect(s.stairs.roomIndex).toBe(last);
    const c = roomCenter(s, last);
    expect(s.stairs.x).toBeCloseTo(c.x, 9);
    expect(s.stairs.y).toBeCloseTo(c.y, 9);
    expect(s.stairs.active).toBe(true);
  });

  it('is player-PATH dependent: a different last-cleared room => different stairs', () => {
    const a = createGameState();
    const b = createGameState(); // same seed/floor as `a`
    clearFloor(a, 1);
    clearFloor(b, 3);
    expect(a.stairs.roomIndex).toBe(1);
    expect(b.stairs.roomIndex).toBe(3);
    expect(a.stairs.roomIndex).not.toBe(b.stairs.roomIndex);
  });
});

describe('Descent — all-cleared trigger', () => {
  it('stairs stay inactive while any room is not cleared', () => {
    const s = createGameState();
    update(s, idle(), DT);
    expect(s.rooms.some((r) => r.phase !== 'cleared')).toBe(true);
    expect(s.stairs.active).toBe(false);
  });

  it('stairs activate once every room is cleared (player away from them)', () => {
    const s = createGameState();
    clearFloor(s, 1);
    expect(s.stairs.active).toBe(true);
    expect(s.run.depth).toBe(1); // activating is not descending
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
    // Build up a within-run state on floor 1.
    s.player.pierce = true;
    s.player.meleeKnockback = true;
    s.player.health = 50; // hurt, below max — must NOT be refilled by descending
    expect(s.player.health).toBeLessThan(PLAYER_COMBAT.maxHealth);

    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // DESCEND to floor 2

    expect(s.run.depth).toBe(2); // confirm we actually descended
    expect(s.player.pierce).toBe(true); // carried
    expect(s.player.meleeKnockback).toBe(true); // carried
    expect(s.player.health).toBe(50); // carried verbatim — NOT refilled, NOT reset
  });

  it('the build keeps compounding across multiple descents', () => {
    const s = createGameState();
    s.player.pierce = true;
    s.player.health = 40;

    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 2
    clearFloor(s, 1);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 3

    expect(s.run.depth).toBe(3);
    expect(s.player.pierce).toBe(true); // still carried two floors down
    expect(s.player.health).toBe(40); // still the carried value
  });

  it('a NEW run fully resets the player (toggles off, health full)', () => {
    const s = createGameState();
    s.player.pierce = true;
    s.player.meleeKnockback = true;
    s.player.health = 50;

    startNewRun(s, 4242);

    expect(s.run.depth).toBe(1);
    expect(s.player.pierce).toBe(false); // reset
    expect(s.player.meleeKnockback).toBe(false); // reset
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
