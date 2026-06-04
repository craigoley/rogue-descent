import { describe, expect, it } from 'vitest';
import { nearestLiveEnemyInRoom, type PointEnemy } from '../softlock';

const rect = { x: 5, y: 5, w: 6, h: 6 }; // tiles [5,11) x [5,11)
const TS = 1;
const E = (x: number, y: number, active = true): PointEnemy => ({ active, x, y });

describe('softlock detector predicate — nearestLiveEnemyInRoom', () => {
  it('SUPPRESSES the kite false-positive: a lone in-room (distant) enemy is resolvable', () => {
    // Enemy is inside the rect but far from the player — resolvable by walking
    // over, so the detector must reset (NOT fire).
    const player = { x: 8, y: 8 };
    const enemies = [E(10.5, 10.5)]; // tile (10,10) — inside [5,11)
    expect(nearestLiveEnemyInRoom(enemies, player.x, player.y, rect, TS)).toBe(true);
  });

  it('STILL FIRES on a genuinely escaped enemy: nearest live enemy is OUT of the room', () => {
    const player = { x: 8, y: 8 };
    const enemies = [E(14, 8)]; // tile 14 — outside the rect -> unreachable
    expect(nearestLiveEnemyInRoom(enemies, player.x, player.y, rect, TS)).toBe(false);
  });

  it('uses the NEAREST enemy: in-room nearest + far out-of-room -> resolvable', () => {
    const player = { x: 8, y: 8 };
    const enemies = [E(9, 8) /* in-room, near */, E(14, 8) /* out, far */];
    expect(nearestLiveEnemyInRoom(enemies, player.x, player.y, rect, TS)).toBe(true);
  });

  it('uses the NEAREST enemy: out-of-room nearest -> fires even if a farther one is in-room', () => {
    const player = { x: 10.9, y: 8 }; // near the right edge (tile 10, inside)
    const enemies = [E(11.5, 8) /* out, near */, E(6, 8) /* in-room, far */];
    expect(nearestLiveEnemyInRoom(enemies, player.x, player.y, rect, TS)).toBe(false);
  });

  it('ignores inactive enemies; no live enemies -> not resolvable (false)', () => {
    const player = { x: 8, y: 8 };
    expect(nearestLiveEnemyInRoom([E(8, 8, false)], player.x, player.y, rect, TS)).toBe(false);
    expect(nearestLiveEnemyInRoom([], player.x, player.y, rect, TS)).toBe(false);
  });
});
