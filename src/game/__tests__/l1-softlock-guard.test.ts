/**
 * L1 integration scenario (d) — the PERMANENT SOFTLOCK GUARD. The teleport/stuck-
 * room bug that ate days (#39 double-activation, #42 door-lock resolver runaway,
 * #43 corridor pass-through activation) becomes a forever-guard, asserted END-TO-
 * END through the real update() loop. The dedicated unit tests prove each fix in
 * isolation; this bakes the family into one named integration check that runs the
 * whole loop over many frames, so a future change that re-opens the softlock fails
 * `npm test` (which every PR + the claude-review pipeline runs).
 *
 * Deterministic: fixed seed + synthetic geometry + scripted input, no wall-clock /
 * Math.random.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { isSolid, type RoomState } from '../Room';
import type { RoomEncounter } from '../Encounter';
import { activeEnemyCount, spawnEnemy } from '../Enemy';
import { ENEMY_COMMON, SIM_DT } from '../../utils/constants';
import { idle, placeInRoom, insideRoomRect } from './l1-harness';

const DT = SIM_DT;
/** The #37/#42 per-step move cap, in world units (ROOM.tileSize is 1). */
const MAX_STEP = ENEMY_COMMON.maxStepTiles;

/** Kill every living enemy belonging to room `i` (drives it toward 'cleared'). */
function killRoomEnemies(s: GameState, i: number): void {
  for (const e of s.enemies) if (e.active && e.roomIndex === i) e.active = false;
}

describe('L1 integration: softlock regression guard (#39 / #42 / #43)', () => {
  it('full room lifecycle: enter → active → cleared → activeRoom -1, never teleporting', () => {
    const s = createGameState(); // deterministic (DUNGEON.defaultSeed)
    const room = s.rooms.findIndex((r, i) => i > 0 && r.phase === 'idle');
    expect(room).toBeGreaterThan(0);

    placeInRoom(s, room);
    update(s, idle(), DT); // genuine body-floor entry → activates + locks doors
    expect(s.rooms[room].phase).toBe('active');
    expect(s.activeRoom).toBe(room);

    // Step through the locked-door frames: the player must never be flung (#42) and
    // must stay inside its room rect (no teleport into the sealed corridor).
    for (let f = 0; f < 20; f++) {
      const x0 = s.player.x;
      const y0 = s.player.y;
      update(s, idle(), DT);
      expect(Math.hypot(s.player.x - x0, s.player.y - y0)).toBeLessThanOrEqual(MAX_STEP + 1e-9);
      expect(insideRoomRect(s, room, s.player.x, s.player.y)).toBe(true);
    }

    // Clear it → the room resolves and frees the active slot (no permanent stall).
    killRoomEnemies(s, room);
    update(s, idle(), DT);
    expect(s.rooms[room].phase).toBe('cleared');
    expect(s.activeRoom).toBe(-1);
  });

  it('#42 — a door locking under the player never embeds or flings them', () => {
    const s = createGameState();
    // Make a room active with its door ring walkable (the #42 fixture shape).
    const room = s.rooms.findIndex((r, i) => i > 0 && r.phase === 'idle' && r.doorCells.length >= 2);
    expect(room).toBeGreaterThan(0);
    s.rooms[room].phase = 'active';
    s.activeRoom = room;
    for (const c of s.rooms[room].doorCells) s.room.solid[c.ty * s.room.tilesX + c.tx] = false;
    // A living enemy in the room keeps it ACTIVE (roomEnemyCount > 0) so the doors
    // stay LOCKED across the frames below — otherwise an empty active room resolves
    // + unlocks on frame 0 and the runaway precondition never arises.
    const rr = s.rooms[room].rect;
    const ts = s.room.tileSize;
    spawnEnemy(s.enemies, (rr.x + rr.w / 2) * ts, (rr.y + rr.h / 2) * ts, 1, 'chaser', room);

    // Stand the player ON a door cell — the exact runaway precondition (the door
    // would lock under them). updateEncounterDoors (in update) must SKIP that cell.
    const door = s.rooms[room].doorCells[0];
    s.player.x = (door.tx + 0.5) * s.room.tileSize;
    s.player.y = (door.ty + 0.5) * s.room.tileSize;

    for (let f = 0; f < 30; f++) {
      const x0 = s.player.x;
      const y0 = s.player.y;
      update(s, idle(), DT);
      // (a) never flung a full tile (the resolver-runaway fingerprint), and
      // (b) never embedded in a solid cell (the precondition that caused it).
      expect(Math.hypot(s.player.x - x0, s.player.y - y0)).toBeLessThanOrEqual(MAX_STEP + 1e-9);
      const tx = Math.floor(s.player.x / s.room.tileSize);
      const ty = Math.floor(s.player.y / s.room.tileSize);
      expect(isSolid(s.room, tx, ty)).toBe(false);
    }
    expect(s.activeRoom).toBe(room); // still the single active room
  });

  it('#43 — a corridor carved THROUGH a room rect never spuriously activates it', () => {
    // Synthetic: one idle room with a corridor strip across its middle row.
    const W = 12;
    const H = 12;
    const corridorRow = 6;
    const corridor = new Array<boolean>(W * H).fill(false);
    for (let tx = 0; tx < W; tx++) corridor[corridorRow * W + tx] = true;
    const grid: RoomState = {
      tilesX: W,
      tilesY: H,
      tileSize: 1,
      walls: [],
      solid: new Array<boolean>(W * H).fill(false),
      corridor,
    };
    const enc: RoomEncounter = {
      rect: { x: 3, y: 3, w: 6, h: 6 }, // ty 3..8, so row 6 cuts through it
      phase: 'idle',
      spawns: [{ x: 6.5, y: 6.5, type: 'chaser' }],
      doorCells: [],
      dropsSpawned: 0,
      dropsCollected: 0,
    };
    const s = createGameState();
    s.room = grid;
    s.rooms = [enc];
    s.activeRoom = -1;
    for (const e of s.enemies) e.active = false;

    // On the corridor strip INSIDE the rect → must NOT activate (pass-through).
    s.player.x = 5.5;
    s.player.y = corridorRow + 0.5;
    update(s, idle(), DT);
    expect(s.rooms[0].phase).toBe('idle');
    expect(s.activeRoom).toBe(-1);
    expect(activeEnemyCount(s.enemies)).toBe(0);

    // On the room BODY floor (off the corridor row) → genuine entry, DOES activate.
    s.player.x = 5.5;
    s.player.y = corridorRow - 2 + 0.5;
    update(s, idle(), DT);
    expect(s.rooms[0].phase).toBe('active');
    expect(s.activeRoom).toBe(0);
  });

  it('enter-then-LEAVE — a player who exits an active room BEFORE clearing is never sealed OUT', () => {
    // The enter-then-leave softlock (Craig's repro): the room activated + the entry
    // door deferred (occupancy-skip), then the player walked back OUT and the door
    // sealed BEHIND them — stranding them outside a live, locked room forever.
    const s = createGameState();
    const room = s.rooms.findIndex((r, i) => i > 0 && r.phase === 'idle' && r.doorCells.length >= 1);
    expect(room).toBeGreaterThan(0);
    s.rooms[room].phase = 'active';
    s.activeRoom = room;
    for (const c of s.rooms[room].doorCells) s.room.solid[c.ty * s.room.tilesX + c.tx] = false;
    // A living enemy keeps the room a real fight (roomEnemyCount > 0).
    const rr = s.rooms[room].rect;
    const ts = s.room.tileSize;
    spawnEnemy(s.enemies, (rr.x + rr.w / 2) * ts, (rr.y + rr.h / 2) * ts, 1, 'chaser', room);

    // Player in the doorway (the un-sealed window — the entry door deferred open).
    const door = s.rooms[room].doorCells[0];
    s.player.x = (door.tx + 0.5) * ts;
    s.player.y = (door.ty + 0.5) * ts;
    update(s, idle(), DT); // standing IN the door → grace; the room is still active
    expect(s.rooms[room].phase).toBe('active');

    // The player completes the exit — past the doorway, out to spawn.
    s.player.x = s.spawn.x;
    s.player.y = s.spawn.y;
    update(s, idle(), DT);

    // FIXED: the room DEACTIVATES instead of sealing behind the fleeing player.
    expect(s.rooms[room].phase).toBe('idle'); // reverted (was 'active' + STUCK pre-fix)
    expect(s.activeRoom).toBe(-1); // active slot freed
    for (const c of s.rooms[room].doorCells) expect(isSolid(s.room, c.tx, c.ty)).toBe(false); // unlocked
    expect(activeEnemyCount(s.enemies)).toBe(0); // its fight despawned (re-arms on re-entry)

    // ...and re-entering AND staying re-activates it cleanly (fresh fight).
    placeInRoom(s, room);
    update(s, idle(), DT);
    expect(s.rooms[room].phase).toBe('active');
    expect(s.activeRoom).toBe(room);
    expect(activeEnemyCount(s.enemies)).toBeGreaterThan(0); // respawned from enc.spawns
  });

  it('enter-and-STAY — staying inside still SEALS (all doors solid) and the fight gates → unlock on clear', () => {
    // The inverse of the fix: it must NOT have broken the normal case. Walk in and
    // STAY → the room seals around you, the fight gates, clearing unlocks.
    const s = createGameState();
    const room = s.rooms.findIndex((r, i) => i > 0 && r.phase === 'idle' && r.doorCells.length >= 1);
    placeInRoom(s, room); // genuine body-floor entry, then stay
    update(s, idle(), DT);
    expect(s.rooms[room].phase).toBe('active');

    for (let f = 0; f < 5; f++) update(s, idle(), DT); // stay a few frames
    for (const c of s.rooms[room].doorCells) expect(isSolid(s.room, c.tx, c.ty)).toBe(true); // SEALED
    expect(s.activeRoom).toBe(room); // still the single active room (no spurious deactivate)

    killRoomEnemies(s, room);
    update(s, idle(), DT);
    expect(s.rooms[room].phase).toBe('cleared'); // clears on roomEnemyCount === 0
    for (const c of s.rooms[room].doorCells) expect(isSolid(s.room, c.tx, c.ty)).toBe(false); // unlocked
    expect(s.activeRoom).toBe(-1);
  });

  it('#39 — a second room never double-activates while one is live', () => {
    const s = createGameState();
    const a = s.rooms.findIndex((r, i) => i > 0 && r.phase === 'idle');
    const b = s.rooms.findIndex((r, i) => i > a && r.phase === 'idle');
    expect(b).toBeGreaterThan(0);

    placeInRoom(s, a);
    update(s, idle(), DT);
    expect(s.rooms[a].phase).toBe('active');
    const nA = activeEnemyCount(s.enemies);
    expect(nA).toBeGreaterThan(0);

    // Force the player's centre into room B's rect while A is still active.
    placeInRoom(s, b);
    update(s, idle(), DT);
    expect(s.rooms[b].phase).toBe('idle'); // B did NOT activate
    expect(s.activeRoom).toBe(a); // active room unchanged (not orphaned)
    expect(activeEnemyCount(s.enemies)).toBe(nA); // no second spawn (was 6-instead-of-3)
  });
});
