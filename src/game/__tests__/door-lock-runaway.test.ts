/**
 * Regression coverage for the door-lock resolver runaway (BUG 2 — the proven
 * "teleport / shot into a wall" softlock). Root cause: setDoors solidified a
 * door-ring cell the player occupied, embedding the player; the single-resolve
 * collision then ejected them a full tile per tick across the map. Two fixes:
 *   (a) setDoors skips cells the player's box overlaps; a per-frame re-lock
 *       (updateEncounterDoors) seals them once the player steps off.
 *   (b) the player's per-step move is clamped to < 1 tile (the #37 enemy cap,
 *       ENEMY_COMMON.maxStepTiles) so a resolver ejection can't fling the player.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { createPlayer, updatePlayer } from '../Player';
import { createIntent } from '../Input';
import { isSolid, type RoomState } from '../Room';
import { resolveX } from '../Collision';
import { updateEncounterDoors } from '../Encounter';
import { ENEMY_COMMON, DASH, PLAYER, SIM_DT, TUNING } from '../../utils/constants';

const DT = SIM_DT;
const MAX_STEP = ENEMY_COMMON.maxStepTiles; // tileSize is 1 in these rooms

/** A 3-tall room with `solidCols` solid in the middle row (rest of the row is
 *  floor), bordered by solid rows — lets us EMBED a box in a solid cell. */
function rowRoom(tilesX: number, solidCols: number[]): RoomState {
  const tilesY = 3;
  const solid = new Array<boolean>(tilesX * tilesY).fill(false);
  for (let tx = 0; tx < tilesX; tx++) {
    solid[0 * tilesX + tx] = true; // top border
    solid[2 * tilesX + tx] = true; // bottom border
  }
  for (const c of solidCols) solid[1 * tilesX + c] = true;
  return { tilesX, tilesY, tileSize: 1, walls: [], solid };
}

describe('(b) player per-step clamp — resolver ejection is bounded', () => {
  it('legit speeds (maxSpeed + dash) are under the cap, so normal play is unaffected', () => {
    expect(TUNING.maxSpeed * SIM_DT).toBeLessThan(MAX_STEP);
    expect((TUNING.dashDist / DASH.duration) * SIM_DT).toBeLessThan(MAX_STEP);
  });

  it('the resolver CAN eject an embedded box more than a tile (the danger the clamp bounds)', () => {
    // Player embedded in solid cell 2, "pushed" +x into solid cell 4: the
    // single-resolve eject lands it a full tile+ away — > MAX_STEP.
    const room = rowRoom(8, [2, 3, 4]);
    const raw = resolveX(2.5, 1.5, 1.5, PLAYER.radius, room);
    expect(Math.abs(raw - 2.5)).toBeGreaterThan(MAX_STEP); // unclamped ejection > 1 tile
  });

  it('updatePlayer NEVER moves the player a full tile in one tick, even when embedded', () => {
    const room = rowRoom(8, [2, 3, 4]);
    const p = createPlayer(2.5, 1.5); // embedded in solid cell 2
    p.vx = 90; // absurd velocity (simulates a runaway push); friction leaves it huge for a tick
    const x0 = p.x;
    updatePlayer(p, createIntent(), DT, room);
    expect(Math.abs(p.x - x0)).toBeLessThanOrEqual(MAX_STEP + 1e-9); // capped (was ~1.1 unclamped)
  });

  it('repeated ticks can never march the player across the map', () => {
    const room = rowRoom(20, [5, 6, 7, 8, 9, 10, 11, 12]); // long solid row
    const p = createPlayer(6.5, 1.5);
    p.vx = 200;
    for (let k = 0; k < 30; k++) {
      const x0 = p.x;
      updatePlayer(p, createIntent(), DT, room);
      expect(Math.abs(p.x - x0)).toBeLessThanOrEqual(MAX_STEP + 1e-9); // no full-tile JUMP, ever
    }
  });
});

describe('(a) door-lock skips the player + re-locks on vacate', () => {
  /** A floor with an active room that has >= 2 door cells (so we can test a
   *  player-occupied cell vs an unoccupied one). */
  function activeRoomWithDoors(): { s: GameState; room: number } {
    const s = createGameState();
    const room = s.rooms.findIndex((r, i) => i > 0 && r.phase === 'idle' && r.doorCells.length >= 2);
    s.activeRoom = room;
    s.rooms[room].phase = 'active';
    // Ensure all this room's door cells start UNLOCKED (walkable) for the test.
    for (const c of s.rooms[room].doorCells) s.room.solid[c.ty * s.room.tilesX + c.tx] = false;
    return { s, room };
  }
  const cellSolid = (s: GameState, c: { tx: number; ty: number }): boolean =>
    isSolid(s.room, c.tx, c.ty);
  const placeOn = (s: GameState, c: { tx: number; ty: number }): void => {
    s.player.x = (c.tx + 0.5) * s.room.tileSize;
    s.player.y = (c.ty + 0.5) * s.room.tileSize;
  };

  it('does NOT lock the cell the player occupies, but locks the others', () => {
    const { s, room } = activeRoomWithDoors();
    const [occupied, other] = s.rooms[room].doorCells;
    placeOn(s, occupied);
    updateEncounterDoors(s);
    expect(cellSolid(s, occupied)).toBe(false); // skipped — not slammed on the player
    expect(cellSolid(s, other)).toBe(true); // every other doorway sealed
  });

  it('the player is never embedded after a lock (the runaway precondition is gone)', () => {
    const { s, room } = activeRoomWithDoors();
    const occupied = s.rooms[room].doorCells[0];
    placeOn(s, occupied);
    updateEncounterDoors(s);
    const tx = Math.floor(s.player.x / s.room.tileSize);
    const ty = Math.floor(s.player.y / s.room.tileSize);
    expect(isSolid(s.room, tx, ty)).toBe(false); // the player's own tile is never solid
  });

  // The deferred door's fate depends on the DIRECTION the player vacates it (the
  // enter-then-leave softlock fix). The embed protection this test once also covered
  // — the door is never slammed UNDER the player — still lives in the two tests above
  // ('does NOT lock the cell the player occupies' + 'never embedded after a lock') and
  // in the (b) per-step clamp block; it is NOT lost by this split.
  it('VACATE INWARD — the player steps DEEPER into the room → the deferred door SEALS', () => {
    const { s, room } = activeRoomWithDoors();
    const occupied = s.rooms[room].doorCells[0];
    placeOn(s, occupied);
    updateEncounterDoors(s);
    expect(cellSolid(s, occupied)).toBe(false); // deferred while occupied

    const rect = s.rooms[room].rect;
    s.player.x = (rect.x + rect.w / 2) * s.room.tileSize; // step to the room CENTRE (still inside)
    s.player.y = (rect.y + rect.h / 2) * s.room.tileSize;
    updateEncounterDoors(s);
    expect(cellSolid(s, occupied)).toBe(true); // sealed once the player is clear, INSIDE
    for (const c of s.rooms[room].doorCells) expect(cellSolid(s, c)).toBe(true); // fully sealed
    expect(s.rooms[room].phase).toBe('active'); // sealed IN → the fight gates normally
    expect(s.activeRoom).toBe(room);
  });

  it('VACATE OUTWARD — the player leaves the rect → the room DEACTIVATES (never sealed out)', () => {
    const { s, room } = activeRoomWithDoors();
    const occupied = s.rooms[room].doorCells[0];
    placeOn(s, occupied);
    updateEncounterDoors(s);
    expect(cellSolid(s, occupied)).toBe(false); // deferred while occupied

    s.player.x = s.spawn.x; // flee OUT of the room (to spawn, past the doorway)
    s.player.y = s.spawn.y;
    updateEncounterDoors(s);
    // The softlock fix: the door does NOT seal behind the fleeing player; the room
    // reverts to idle so the player is never trapped outside a live room.
    expect(s.rooms[room].phase).toBe('idle');
    expect(s.activeRoom).toBe(-1);
    for (const c of s.rooms[room].doorCells) expect(cellSolid(s, c)).toBe(false); // unlocked
  });

  it('a locked (non-occupied) door cell is solid — normal door collision intact', () => {
    const { s, room } = activeRoomWithDoors();
    const other = s.rooms[room].doorCells[1];
    placeOn(s, s.rooms[room].doorCells[0]); // occupy a DIFFERENT cell
    updateEncounterDoors(s);
    expect(cellSolid(s, other)).toBe(true); // barrier present -> resolveX/Y will block it
  });
});
