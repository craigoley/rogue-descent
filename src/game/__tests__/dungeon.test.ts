import { describe, expect, it } from 'vitest';
import { generateDungeon, isConnected, type Rect } from '../Dungeon';
import { isSolid } from '../Room';
import { DUNGEON } from '../../utils/constants';

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('Dungeon — determinism', () => {
  it('same seed => byte-identical floor', () => {
    const a = generateDungeon(42);
    const b = generateDungeon(42);
    expect(a.room.solid).toEqual(b.room.solid);
    expect(a.rooms).toEqual(b.rooms);
    expect(a.spawn).toEqual(b.spawn);
  });

  it('different seeds => different floors', () => {
    const a = generateDungeon(1);
    const b = generateDungeon(2);
    expect(a.room.solid).not.toEqual(b.room.solid);
  });
});

describe('Dungeon — connectivity (the load-bearing property)', () => {
  it('every room is reachable from the spawn room, across 100 seeds', () => {
    for (const seed of SEEDS) {
      const floor = generateDungeon(seed);
      expect(isConnected(floor), `seed ${seed} produced a disconnected floor`).toBe(true);
    }
  });
});

describe('Dungeon — no overlap / in bounds', () => {
  it('rooms never overlap and stay inside the floor (with the wall ring), 100 seeds', () => {
    for (const seed of SEEDS) {
      const { rooms } = generateDungeon(seed);
      for (const r of rooms) {
        expect(r.x, `seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(r.y, `seed ${seed}`).toBeGreaterThanOrEqual(1);
        expect(r.x + r.w, `seed ${seed}`).toBeLessThanOrEqual(DUNGEON.tilesX - 1);
        expect(r.y + r.h, `seed ${seed}`).toBeLessThanOrEqual(DUNGEON.tilesY - 1);
      }
      for (let i = 0; i < rooms.length; i++) {
        for (let j = i + 1; j < rooms.length; j++) {
          expect(overlaps(rooms[i], rooms[j]), `seed ${seed} rooms ${i}/${j} overlap`).toBe(false);
        }
      }
    }
  });
});

describe('Dungeon — spawn + room count', () => {
  it('player spawn is on a walkable cell, across 100 seeds', () => {
    for (const seed of SEEDS) {
      const floor = generateDungeon(seed);
      const tx = Math.floor(floor.spawn.x / floor.room.tileSize);
      const ty = Math.floor(floor.spawn.y / floor.room.tileSize);
      expect(isSolid(floor.room, tx, ty), `seed ${seed} spawned in a wall`).toBe(false);
    }
  });

  it('room count stays within [minRooms, maxRooms], across 100 seeds', () => {
    for (const seed of SEEDS) {
      const { rooms } = generateDungeon(seed);
      expect(rooms.length, `seed ${seed}`).toBeGreaterThanOrEqual(DUNGEON.minRooms);
      expect(rooms.length, `seed ${seed}`).toBeLessThanOrEqual(DUNGEON.maxRooms);
    }
  });
});
