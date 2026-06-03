import { describe, expect, it } from 'vitest';
import {
  damageMultForDepth,
  enemiesPerRoomForDepth,
  healthMultForDepth,
  speedMultForDepth,
} from '../Difficulty';
import { createGameState, regenerate, update, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { DIFFICULTY, ENCOUNTER, ENEMY, POOL, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

describe('Difficulty — depth 1 is baseline (floor 1 unchanged)', () => {
  it('count == base and every multiplier == 1.0 at depth 1', () => {
    expect(enemiesPerRoomForDepth(1)).toBe(ENCOUNTER.enemiesPerRoom);
    expect(healthMultForDepth(1)).toBe(1);
    expect(damageMultForDepth(1)).toBe(1);
    expect(speedMultForDepth(1)).toBe(1);
  });

  it('clamps depths below 1 to the baseline (defensive)', () => {
    expect(enemiesPerRoomForDepth(0)).toBe(ENCOUNTER.enemiesPerRoom);
    expect(healthMultForDepth(0)).toBe(1);
  });
});

describe('Difficulty — smooth monotonic ramp (no inversion/spike)', () => {
  it('count and every multiplier are non-decreasing across depths 1..12', () => {
    for (let d = 1; d < 12; d++) {
      expect(enemiesPerRoomForDepth(d + 1)).toBeGreaterThanOrEqual(enemiesPerRoomForDepth(d));
      expect(healthMultForDepth(d + 1)).toBeGreaterThanOrEqual(healthMultForDepth(d));
      expect(damageMultForDepth(d + 1)).toBeGreaterThanOrEqual(damageMultForDepth(d));
      expect(speedMultForDepth(d + 1)).toBeGreaterThanOrEqual(speedMultForDepth(d));
    }
  });

  it('count never exceeds the enemy pool, and saturates at it', () => {
    for (let d = 1; d <= 100; d++) {
      expect(enemiesPerRoomForDepth(d)).toBeLessThanOrEqual(POOL.enemies);
    }
    expect(enemiesPerRoomForDepth(100)).toBe(POOL.enemies);
  });
});

describe('Difficulty — stats scale by the expected factor', () => {
  it('depth-5 multipliers match the linear curve and beat depth 1', () => {
    expect(healthMultForDepth(5)).toBeCloseTo(1 + 4 * DIFFICULTY.healthMultPerDepth, 9);
    expect(damageMultForDepth(5)).toBeCloseTo(1 + 4 * DIFFICULTY.damageMultPerDepth, 9);
    expect(speedMultForDepth(5)).toBeCloseTo(1 + 4 * DIFFICULTY.speedMultPerDepth, 9);
    expect(healthMultForDepth(5)).toBeGreaterThan(healthMultForDepth(1));
  });

  it('speed scales the most gently (speed < damage < health per depth)', () => {
    expect(DIFFICULTY.speedMultPerDepth).toBeLessThan(DIFFICULTY.damageMultPerDepth);
    expect(DIFFICULTY.damageMultPerDepth).toBeLessThan(DIFFICULTY.healthMultPerDepth);
  });
});

describe('Difficulty — applied to actually-spawned enemies (determinism preserved)', () => {
  /** Rebuild this floor's encounters at `depth` (loadFloor reads run.depth via
   *  regenerate, which leaves run untouched), enter the first idle room, and
   *  return the freshly-spawned enemies. */
  function activateRoomEnemies(s: GameState, depth: number): GameState['enemies'] {
    s.run.depth = depth;
    regenerate(s, s.seed); // re-arm encounters at this depth
    const i = s.rooms.findIndex((r, idx) => idx > 0 && r.phase === 'idle');
    const r = s.rooms[i].rect;
    const ts = s.room.tileSize;
    s.player.x = (r.x + r.w / 2) * ts;
    s.player.y = (r.y + r.h / 2) * ts;
    update(s, idle(), DT); // entering the idle room activates + spawns
    return s.enemies.filter((e) => e.active);
  }

  it('depth 1 spawns baseline count + stats', () => {
    const live = activateRoomEnemies(createGameState(), 1);
    expect(live.length).toBe(ENCOUNTER.enemiesPerRoom);
    expect(live[0].moveSpeed).toBeCloseTo(ENEMY.moveSpeed, 9);
    expect(live[0].attackDamage).toBeCloseTo(ENEMY.attackDamage, 9);
    expect(live[0].health).toBeCloseTo(ENEMY.maxHealth, 9);
  });

  it('depth 5 spawns more + tougher enemies (scaled by the curve)', () => {
    const live = activateRoomEnemies(createGameState(), 5);
    expect(live.length).toBe(enemiesPerRoomForDepth(5));
    expect(live.length).toBeGreaterThan(ENCOUNTER.enemiesPerRoom);
    expect(live[0].moveSpeed).toBeCloseTo(ENEMY.moveSpeed * speedMultForDepth(5), 9);
    expect(live[0].attackDamage).toBeCloseTo(ENEMY.attackDamage * damageMultForDepth(5), 9);
    expect(live[0].health).toBeCloseTo(ENEMY.maxHealth * healthMultForDepth(5), 9);
  });

  it('same seed + same depth => identical spawn count + stats (deterministic)', () => {
    const a = activateRoomEnemies(createGameState(), 4);
    const b = activateRoomEnemies(createGameState(), 4);
    expect(a.length).toBe(b.length);
    expect(a[0].health).toBe(b[0].health);
    expect(a[0].moveSpeed).toBe(b[0].moveSpeed);
    expect(a[0].attackDamage).toBe(b[0].attackDamage);
  });
});
