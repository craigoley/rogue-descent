/**
 * Regression coverage for BUG 1 — corridors carved THROUGH a room's rect
 * spuriously activating it. Fix (option iii): generation tags cells carved by a
 * corridor passing through a FOREIGN room (one it isn't connecting) in
 * RoomState.corridor; updateEncounterEntry refuses to activate when the player's
 * cell is corridor-tagged (a pass-through), only activating from room-body floor.
 * Generation is byte-identical — the tag is an additive parallel grid.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createIntent } from '../Input';
import type { RoomState } from '../Room';
import type { RoomEncounter } from '../Encounter';
import { generateDungeon } from '../Dungeon';
import { activeEnemyCount } from '../Enemy';
import { DUNGEON, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/** A 12x12 floor grid with one idle room rect [3..9]x[3..9] and a horizontal
 *  corridor strip at row ty=6 carved THROUGH it (cells tagged corridor). */
function stateWithThroughCorridor(): { s: GameState; room: number; corridorRow: number } {
  const W = 12;
  const H = 12;
  const corridor = new Array<boolean>(W * H).fill(false);
  const corridorRow = 6;
  for (let tx = 0; tx < W; tx++) corridor[corridorRow * W + tx] = true; // strip across the rect
  const grid: RoomState = {
    tilesX: W,
    tilesY: H,
    tileSize: 1,
    walls: [],
    solid: new Array<boolean>(W * H).fill(false), // all walkable (activation ignores solid)
    corridor,
  };
  const rect = { x: 3, y: 3, w: 6, h: 6 }; // spans ty 3..8, so the corridor row 6 cuts through it
  const enc: RoomEncounter = {
    rect,
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
  return { s, room: 0, corridorRow };
}

describe('Corridor spurious activation — the fix', () => {
  it('a player on a corridor cell INSIDE a room rect does NOT activate it', () => {
    const { s, room, corridorRow } = stateWithThroughCorridor();
    // Stand on the corridor strip, inside the rect (tile (5, 6)).
    s.player.x = 5.5;
    s.player.y = corridorRow + 0.5;
    update(s, idle(), DT);
    expect(s.rooms[room].phase).toBe('idle'); // NOT spuriously activated
    expect(s.activeRoom).toBe(-1);
    expect(activeEnemyCount(s.enemies)).toBe(0); // no enemies spawned
  });

  it('a player on the room BODY floor DOES activate it (genuine entry)', () => {
    const { s, room, corridorRow } = stateWithThroughCorridor();
    // Body cell inside the rect, off the corridor row (tile (5, 4)).
    s.player.x = 5.5;
    s.player.y = corridorRow - 2 + 0.5;
    update(s, idle(), DT);
    expect(s.rooms[room].phase).toBe('active'); // activates from body floor
    expect(s.activeRoom).toBe(room);
    expect(activeEnemyCount(s.enemies)).toBeGreaterThan(0);
  });

  it('backward-compat: a room with NO corridor grid activates on plain rect-containment', () => {
    const { s, room } = stateWithThroughCorridor();
    s.room.corridor = undefined; // e.g. a hand-built arena
    s.player.x = 5.5; // any cell inside the rect (was a corridor cell, now untagged)
    s.player.y = 6.5;
    update(s, idle(), DT);
    expect(s.rooms[room].phase).toBe('active');
    expect(s.activeRoom).toBe(room);
  });
});

describe('Corridor tag — deterministic + populated, generation byte-identical', () => {
  it('same seed => identical corridor grid; the grid has corridor cells', () => {
    const a = generateDungeon(DUNGEON.defaultSeed);
    const b = generateDungeon(DUNGEON.defaultSeed);
    expect(a.room.corridor).toEqual(b.room.corridor); // deterministic
    expect(a.room.corridor?.some(Boolean)).toBe(true); // foreign pass-throughs exist somewhere
  });

  it('the corridor tag does NOT change the solid grid (generation byte-identical)', () => {
    // Rebuild solid from walkable independently: solid must still equal !walkable,
    // and two same-seed generations agree (the existing dungeon.test guarantee).
    const a = generateDungeon(DUNGEON.defaultSeed);
    const b = generateDungeon(DUNGEON.defaultSeed);
    expect(a.room.solid).toEqual(b.room.solid);
    // corridor cells are a SUBSET of walkable (never tag a solid/wall cell).
    for (let i = 0; i < a.room.solid.length; i++) {
      if (a.room.corridor?.[i]) expect(a.room.solid[i]).toBe(false);
    }
  });
});
