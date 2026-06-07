/**
 * L1 integration scenario (e) — depth scaling across DESCENTS, end-to-end. Clear +
 * descend floor by floor through the real loop; at each depth assert a freshly-
 * spawned enemy carries the 7c stat scaling, the boss room is valid, and the
 * carried powerup LEVELS persist across the descend (#29/#52). Ties together the
 * per-piece proofs in difficulty.test / descent.test / boss generation.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startNewRun, update, type GameState } from '../GameState';
import { spawnEnemy } from '../Enemy';
import { healthMultForDepth, damageMultForDepth } from '../Difficulty';
import { ENEMY_TYPES, SIM_DT } from '../../utils/constants';
import { idle } from './l1-harness';

const DT = SIM_DT;
const SEED = 9090;

/** Clear the floor + step onto the boss-gated stairs to descend exactly once. The
 *  established clear-and-descend pattern: mark rooms cleared, flag the boss defeated
 *  (the #50 descent gate), let the resolve pin + open the stairs, then stand on them. */
function descendOnce(s: GameState): void {
  for (let i = 0; i < s.rooms.length; i++) s.rooms[i].phase = i === 1 ? 'active' : 'cleared';
  s.activeRoom = 1;
  s.bossDefeated = true;
  s.player.x = s.spawn.x;
  s.player.y = s.spawn.y;
  update(s, idle(), DT); // resolve room 1 -> placeStairs(bossRoom) + stairs.active
  s.player.x = s.stairs.x;
  s.player.y = s.stairs.y;
  update(s, idle(), DT); // step on stairs -> descend (loadFloor)
}

describe('L1 integration: depth scaling across descents', () => {
  it('enemy stats scale by depth, boss room stays valid, and levels carry', () => {
    const s = createGameState();
    startNewRun(s, SEED);
    s.player.meleeLevel = 2; // a carried build to verify persistence across descents
    s.player.pierceLevel = 1;
    expect(s.run.depth).toBe(1);

    const base = ENEMY_TYPES.chaser;

    for (let depth = 1; depth <= 4; depth++) {
      expect(s.run.depth).toBe(depth);

      // Boss room is set + in-bounds + not the spawn room, every floor.
      expect(s.bossRoom).toBeGreaterThan(0);
      expect(s.bossRoom).toBeLessThan(s.rooms.length);

      // A freshly-spawned enemy carries the 7c depth scaling for THIS depth.
      spawnEnemy(s.enemies, s.spawn.x + 3, s.spawn.y, depth, 'chaser', -1);
      const e = s.enemies.find((x) => x.active)!;
      expect(e.health).toBeCloseTo(base.maxHealth * healthMultForDepth(depth), 9);
      expect(e.attackDamage).toBeCloseTo(base.attackDamage * damageMultForDepth(depth), 9);
      e.active = false; // clean up before descending

      // Carried powerup LEVELS persist (never reset by a descent — only by death).
      expect(s.player.meleeLevel).toBe(2);
      expect(s.player.pierceLevel).toBe(1);

      if (depth < 4) descendOnce(s);
    }

    expect(s.run.depth).toBe(4); // descended three floors
    expect(s.run.floorsCleared).toBe(3);
  });

  it('depth-1 is the baseline (mult = 1.0): scaling does not alter floor 1', () => {
    const s = createGameState();
    startNewRun(s, SEED);
    spawnEnemy(s.enemies, s.spawn.x + 3, s.spawn.y, 1, 'chaser', -1);
    const e = s.enemies.find((x) => x.active)!;
    expect(e.health).toBeCloseTo(ENEMY_TYPES.chaser.maxHealth, 9); // ×1.0
    expect(e.attackDamage).toBeCloseTo(ENEMY_TYPES.chaser.attackDamage, 9);
  });
});
