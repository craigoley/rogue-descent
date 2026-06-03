import { describe, expect, it } from 'vitest';
import { createGameState, update, nextFloorSeed, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { generateDungeon, farthestRoomIndex } from '../Dungeon';
import { DESCENT, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/** Mark every room cleared (the all-cleared / stairs-open precondition). */
function clearAllRooms(s: GameState): void {
  for (const r of s.rooms) r.phase = 'cleared';
}

/** Teleport the player onto the (computed) stairs position. */
function standOnStairs(s: GameState): void {
  s.player.x = s.stairs.x;
  s.player.y = s.stairs.y;
}

describe('Descent — farthest-room stairs selection', () => {
  it('stairs go in the room with max distance from spawn (not just rooms[n-1])', () => {
    const floor = generateDungeon(12345);
    const idx = farthestRoomIndex(floor);
    expect(idx).toBeGreaterThan(0); // never the spawn room

    // No room is strictly farther than the chosen one.
    const ts = floor.room.tileSize;
    const d2 = (r: { x: number; y: number; w: number; h: number }): number =>
      ((r.x + r.w / 2) * ts - floor.spawn.x) ** 2 + ((r.y + r.h / 2) * ts - floor.spawn.y) ** 2;
    const chosen = d2(floor.rooms[idx]);
    for (const r of floor.rooms) expect(d2(r)).toBeLessThanOrEqual(chosen + 1e-9);
  });

  it('is deterministic and matches the live floor for a seed', () => {
    const a = createGameState();
    const b = createGameState();
    expect(a.stairs.roomIndex).toBe(b.stairs.roomIndex);
    expect(a.stairs.roomIndex).toBe(farthestRoomIndex(generateDungeon(a.seed)));
    // Stored stairs position is that room's centre.
    const r = a.rooms[a.stairs.roomIndex].rect;
    expect(a.stairs.x).toBeCloseTo((r.x + r.w / 2) * a.room.tileSize, 9);
    expect(a.stairs.y).toBeCloseTo((r.y + r.h / 2) * a.room.tileSize, 9);
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
    clearAllRooms(s);
    // Sit at spawn — the farthest room, so this never contacts the stairs.
    s.player.x = s.spawn.x;
    s.player.y = s.spawn.y;
    update(s, idle(), DT);
    expect(s.stairs.active).toBe(true);
    expect(s.run.depth).toBe(1); // activating is not descending
  });
});

describe('Descent — stepping on active stairs descends', () => {
  it('contact loads the next floor: depth+1, floorsCleared+1, deterministic new seed, rooms re-armed', () => {
    const s = createGameState();
    const seed0 = s.seed;
    clearAllRooms(s);
    standOnStairs(s);
    update(s, idle(), DT);

    expect(s.run.depth).toBe(2);
    expect(s.run.floorsCleared).toBe(1);
    expect(s.seed).toBe(nextFloorSeed(seed0, 2));
    // New floor re-armed: spawn cleared, the rest idle; stairs reset inactive.
    expect(s.rooms[0].phase).toBe('cleared');
    expect(s.rooms.slice(1).every((r) => r.phase === 'idle')).toBe(true);
    expect(s.stairs.active).toBe(false);
    // Player is at the new floor's spawn.
    expect(s.player.x).toBeCloseTo(s.spawn.x, 9);
    expect(s.player.y).toBeCloseTo(s.spawn.y, 9);
  });

  it('does not descend on contact until the stairs are active', () => {
    const s = createGameState();
    standOnStairs(s); // on the stairs tile, but floor not cleared
    update(s, idle(), DT);
    expect(s.run.depth).toBe(1);
    expect(s.seed).toBe(createGameState().seed); // unchanged floor
  });

  it('descending twice accumulates run state (depth 1 -> 3, floorsCleared 2)', () => {
    const s = createGameState();
    clearAllRooms(s);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 2 (new floor)
    clearAllRooms(s);
    standOnStairs(s);
    update(s, idle(), DT); // -> depth 3 (new floor)
    expect(s.run.depth).toBe(3);
    expect(s.run.floorsCleared).toBe(2);
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
