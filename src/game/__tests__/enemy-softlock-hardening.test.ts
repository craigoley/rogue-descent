import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import type { RoomState } from '../Room';
import type { RoomEncounter } from '../Encounter';
import { spawnEnemy, updateEnemies } from '../Enemy';
import { ENEMY_COMMON, ENEMY_TYPES, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;

/** Open room (solid border, empty interior). */
function openRoom(tiles = 40): RoomState {
  const solid = new Array<boolean>(tiles * tiles).fill(false);
  for (let t = 0; t < tiles; t++) {
    solid[t] = true;
    solid[(tiles - 1) * tiles + t] = true;
    solid[t * tiles] = true;
    solid[t * tiles + tiles - 1] = true;
  }
  return { tilesX: tiles, tilesY: tiles, tileSize: 1, walls: [], solid };
}

/** A 12x3 strip: middle row is floor tx 1..10 EXCEPT a 1-tile wall at tx=4, with
 *  walkable floor on BOTH sides — so a tunnelling step would land on the right
 *  floor; a capped step clamps flush on the left. */
function stripWithInteriorWall(): RoomState {
  const tilesX = 12;
  const tilesY = 3;
  const solid = new Array<boolean>(tilesX * tilesY).fill(true);
  for (let tx = 1; tx <= 10; tx++) solid[1 * tilesX + tx] = false; // carve middle row
  solid[1 * tilesX + 4] = true; // the interior wall
  return { tilesX, tilesY, tileSize: 1, walls: [], solid };
}

/** Base state with no encounter (activeRoom -1 -> the rect-clamp is a no-op, so
 *  these isolate the per-step move cap). */
function physicsState(room: RoomState): GameState {
  const s = createGameState();
  s.room = room;
  s.rooms = [];
  s.activeRoom = -1;
  for (const e of s.enemies) e.active = false;
  return s;
}

describe('③(a) knockback cap — no tunnelling at boss scale; unchanged at today scale', () => {
  it('a huge knockback into a 1-tile wall clamps flush (does NOT cross it)', () => {
    const s = physicsState(stripWithInteriorWall());
    // Player on the left floor, close (chaser telegraphs -> stands still), so the
    // ONLY motion is the knockback we inject.
    s.player = createPlayer(3.0, 1.5);
    spawnEnemy(s.enemies, 3.6, 1.5, 1, 'chaser'); // flush against the wall's left face
    const e = s.enemies.find((x) => x.active)!;
    e.kbVx = 300; // boss-scale impulse toward +x (the wall)
    const wallLeft = 4.0;
    for (let k = 0; k < 12; k++) {
      updateEnemies(s, DT);
      expect(e.x).toBeLessThan(wallLeft); // never tunnels onto the right floor
    }
  });

  it('per-step move never exceeds the cap, even with a massive impulse', () => {
    const s = physicsState(openRoom(60));
    s.player = createPlayer(30, 30.5); // close -> telegraph -> _vel 0
    spawnEnemy(s.enemies, 30, 30, 1, 'swarmer');
    const e = s.enemies.find((x) => x.active)!;
    e.kbVx = 500;
    e.kbVy = 500;
    const cap = ENEMY_COMMON.maxStepTiles * s.room.tileSize;
    for (let k = 0; k < 10; k++) {
      const px = e.x;
      const py = e.y;
      updateEnemies(s, DT);
      expect(Math.abs(e.x - px)).toBeLessThanOrEqual(cap + 1e-9);
      expect(Math.abs(e.y - py)).toBeLessThanOrEqual(cap + 1e-9);
    }
  });

  it('at TODAY scale the cap does not bite (sub-tile step passes through unchanged)', () => {
    const s = physicsState(openRoom(60));
    s.player = createPlayer(30, 30.5); // _vel 0 (telegraph)
    spawnEnemy(s.enemies, 30, 30, 1, 'chaser');
    const e = s.enemies.find((x) => x.active)!;
    const kb = 7; // a normal melee knockback
    e.kbVx = kb;
    const kbDecay = Math.pow(ENEMY_COMMON.knockbackDecay, DT);
    const expected = kb * kbDecay * DT; // decay applies, THEN the (uncapped) move
    const x0 = e.x;
    updateEnemies(s, DT);
    expect(expected).toBeLessThan(ENEMY_COMMON.maxStepTiles); // proves cap is irrelevant here
    expect(e.x - x0).toBeCloseTo(expected, 9); // identical to uncapped behaviour
  });
});

describe('③(a) knockback still DECAYS over frames (the shove keeps its feel)', () => {
  it('a sub-cap knockback decays smoothly: steps shrink each frame and never exceed the cap', () => {
    const s = physicsState(openRoom(60));
    // Chaser with the player ON it -> it sits in telegraph/strike/recover (all
    // _vel 0) for >1s, so the ONLY motion is the decaying knockback. A small
    // impulse keeps total travel < attackRange, so it never flips to chasing.
    s.player = createPlayer(30, 30);
    spawnEnemy(s.enemies, 30, 30, 1, 'chaser');
    const e = s.enemies.find((x) => x.active)!;
    e.kbVx = 8; // sub-cap; total travel ~0.8 world units (< attackRange 1.3)
    const cap = ENEMY_COMMON.maxStepTiles;
    let prevStep = Infinity;
    let total = 0;
    for (let k = 0; k < 40; k++) {
      const px = e.x;
      updateEnemies(s, DT);
      const step = e.x - px;
      expect(step).toBeGreaterThanOrEqual(0); // always pushed outward, never reversed by AI
      expect(step).toBeLessThanOrEqual(cap + 1e-9); // cap respected
      expect(step).toBeLessThan(prevStep + 1e-9); // monotonically decaying
      prevStep = step;
      total += step;
    }
    expect(total).toBeGreaterThan(0.5); // the shove still carries the enemy a real distance
    expect(e.kbVx).toBeLessThan(0.05); // ...and the impulse has bled off
  });
});

describe('③(c) room-rect clamp — an enemy can never end a step outside its room', () => {
  it('pulls an out-of-rect enemy back inside the active room rect', () => {
    const s = createGameState();
    s.room = openRoom(20);
    const rect = { x: 5, y: 5, w: 6, h: 6 };
    const enc: RoomEncounter = {
      rect,
      phase: 'active',
      spawns: [],
      doorCells: [],
      dropsSpawned: 0,
      dropsCollected: 0,
    };
    s.rooms = [enc];
    s.activeRoom = 0;
    for (const e of s.enemies) e.active = false;
    s.player = createPlayer(8, 8); // inside the rect
    spawnEnemy(s.enemies, 14, 8, 1, 'chaser'); // OUTSIDE the rect (right of it)
    const e = s.enemies.find((x) => x.active)!;
    const radius = ENEMY_TYPES.chaser.radius;
    updateEnemies(s, DT);
    // AI alone (moveSpeed/60 ≈ 0.055) couldn't pull it from 14 to 10.6 — the clamp did.
    const maxX = (rect.x + rect.w) * s.room.tileSize - radius;
    const minX = rect.x * s.room.tileSize + radius;
    expect(e.x).toBeLessThanOrEqual(maxX + 1e-9);
    expect(e.x).toBeGreaterThanOrEqual(minX - 1e-9);
    expect(e.x).toBeCloseTo(maxX, 6); // clamped to the rect's right inner edge
  });

  it('keeps an enemy inside the rect under heavy knockback toward the edge', () => {
    const s = createGameState();
    s.room = openRoom(20);
    const rect = { x: 5, y: 5, w: 6, h: 6 };
    s.rooms = [
      { rect, phase: 'active', spawns: [], doorCells: [], dropsSpawned: 0, dropsCollected: 0 },
    ];
    s.activeRoom = 0;
    for (const e of s.enemies) e.active = false;
    s.player = createPlayer(8, 8);
    spawnEnemy(s.enemies, 9, 8, 1, 'swarmer');
    const e = s.enemies.find((x) => x.active)!;
    e.kbVx = 400; // hurled toward the +x rect edge
    const radius = ENEMY_TYPES.swarmer.radius;
    const maxX = (rect.x + rect.w) * s.room.tileSize - radius;
    const minY = rect.y * s.room.tileSize + radius;
    const maxY = (rect.y + rect.h) * s.room.tileSize - radius;
    for (let k = 0; k < 15; k++) {
      updateEnemies(s, DT);
      expect(e.x).toBeLessThanOrEqual(maxX + 1e-9);
      expect(e.y).toBeGreaterThanOrEqual(minY - 1e-9);
      expect(e.y).toBeLessThanOrEqual(maxY + 1e-9);
    }
  });
});
