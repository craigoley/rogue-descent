/**
 * Regression coverage for the encounter double-activation softlock (the real
 * root cause Craig hit: walk into a room -> 6 enemies across two rooms -> sealed
 * into one, locked out of the other -> permanent stall). Two defects, fixed:
 *   ① updateEncounterEntry must NOT activate a second room while one is active.
 *   ② a room clears on ITS OWN enemies (roomEnemyCount), not the whole pool.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { isSolid } from '../Room';
import { activeEnemyCount, roomEnemyCount, spawnEnemy } from '../Enemy';
import { SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/** Centre the player in encounter room `i` (world units). */
function placeInRoom(s: GameState, i: number): void {
  const r = s.rooms[i].rect;
  s.player.x = (r.x + r.w / 2) * s.room.tileSize;
  s.player.y = (r.y + r.h / 2) * s.room.tileSize;
}
const firstIdleRoom = (s: GameState): number => s.rooms.findIndex((e) => e.phase === 'idle');
/** Kill every living enemy that belongs to room `i`. */
function killRoomEnemies(s: GameState, i: number): void {
  for (const e of s.enemies) if (e.active && e.roomIndex === i) e.active = false;
}

describe('① single-active-room guard (no double-activation)', () => {
  it('does NOT activate a second room while one is already active', () => {
    const s = createGameState();
    const a = firstIdleRoom(s);
    const b = s.rooms.findIndex((e, i) => i > a && e.phase === 'idle');
    expect(b).toBeGreaterThan(0); // floor has >= 2 idle rooms

    placeInRoom(s, a);
    update(s, idle(), DT);
    expect(s.rooms[a].phase).toBe('active');
    expect(s.activeRoom).toBe(a);
    const nA = activeEnemyCount(s.enemies);
    expect(nA).toBeGreaterThan(0);

    // Force the trigger: player's centre crosses into room B's rect while A is
    // still active (in real play the seal prevents this; the guard defends in
    // depth regardless — e.g. a corridor carved through a room).
    placeInRoom(s, b);
    update(s, idle(), DT);

    expect(s.rooms[b].phase).toBe('idle'); // B did NOT activate
    expect(s.activeRoom).toBe(a); // active room unchanged (not orphaned)
    expect(activeEnemyCount(s.enemies)).toBe(nA); // NO second spawn (was 6-instead-of-3)
  });

  it('can still activate the next room once the active one clears (no deadlock)', () => {
    const s = createGameState();
    const a = firstIdleRoom(s);
    const b = s.rooms.findIndex((e, i) => i > a && e.phase === 'idle');

    placeInRoom(s, a);
    update(s, idle(), DT);
    killRoomEnemies(s, a);
    update(s, idle(), DT); // A clears -> activeRoom freed to -1
    expect(s.rooms[a].phase).toBe('cleared');
    expect(s.activeRoom).toBe(-1);

    placeInRoom(s, b);
    update(s, idle(), DT); // now B is allowed to activate
    expect(s.rooms[b].phase).toBe('active');
    expect(s.activeRoom).toBe(b);
  });
});

describe('② per-room clear (not pool-wide)', () => {
  it('clears the active room when ITS OWN enemies die, even if foreign enemies remain in the pool', () => {
    const s = createGameState();
    const a = firstIdleRoom(s);
    placeInRoom(s, a);
    update(s, idle(), DT);
    expect(roomEnemyCount(s.enemies, a)).toBeGreaterThan(0);

    // Inject a FOREIGN enemy owned by a different room (the orphaned-room enemies
    // that, under the old pool-wide count, kept the active room from ever clearing).
    const foreignRoom = a + 1;
    expect(spawnEnemy(s.enemies, 5, 5, 1, 'chaser', foreignRoom)).toBe(true);
    const foreign = s.enemies.find((e) => e.active && e.roomIndex === foreignRoom)!;

    killRoomEnemies(s, a); // the active room's own enemies are all dead...
    update(s, idle(), DT);

    expect(s.rooms[a].phase).toBe('cleared'); // ...so it CLEARS (old code: stalled here)
    expect(foreign.active).toBe(true); // the foreign enemy is still alive...
    expect(activeEnemyCount(s.enemies)).toBeGreaterThan(0); // ...pool-wide count is non-zero
  });

  it('does NOT clear while the active room still has a living enemy of its own', () => {
    const s = createGameState();
    const a = firstIdleRoom(s);
    placeInRoom(s, a);
    update(s, idle(), DT);

    const own = s.enemies.filter((e) => e.active && e.roomIndex === a);
    for (let k = 1; k < own.length; k++) own[k].active = false; // keep exactly one alive
    update(s, idle(), DT);
    expect(roomEnemyCount(s.enemies, a)).toBe(1);
    expect(s.rooms[a].phase).toBe('active'); // own enemy alive -> still active
  });
});

describe('normal single-room path intact (clear -> unlock)', () => {
  it('locks doors on activate and unlocks them on clear', () => {
    const s = createGameState();
    const a = firstIdleRoom(s);
    const door = s.rooms[a].doorCells[0];
    expect(door).toBeTruthy();

    expect(isSolid(s.room, door.tx, door.ty)).toBe(false); // open before
    placeInRoom(s, a);
    update(s, idle(), DT);
    expect(isSolid(s.room, door.tx, door.ty)).toBe(true); // LOCKED while active

    killRoomEnemies(s, a);
    update(s, idle(), DT);
    expect(s.rooms[a].phase).toBe('cleared');
    expect(isSolid(s.room, door.tx, door.ty)).toBe(false); // UNLOCKED on clear
  });
});
