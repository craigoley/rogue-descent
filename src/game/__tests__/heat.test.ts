/**
 * META LAYER 3 — HEAT. The L1 guards for player-authored challenge:
 *   - ⭐ POWER-NEUTRAL, INVERTED: Heat hardens the WORLD, never the player.
 *   - base (NO_HEAT) = today (the regression floor) — every other test runs at base.
 *   - each modifier scales its TARGETED enemy value; Crowd clamps to the caps.
 *   - deterministic given (seed, heat).
 * Pure sim, Node-testable. The heatStatMults / heatExtraEnemies / heatTotal helpers are
 * unit-pinned too (the maths Heat threads in).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, regenerate, update, type GameState, type RunConfig } from '../GameState';
import { createIntent } from '../Input';
import { activeEnemyCount } from '../Enemy';
import { enemiesPerRoomForDepth } from '../Difficulty';
import {
  NO_HEAT,
  heatExtraEnemies,
  heatStatMults,
  heatTotal,
  normalizeHeat,
  type HeatConfig,
} from '../Heat';
import { HEAT, POOL, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;
const cfg = (heat: HeatConfig): RunConfig => ({ unlocked: new Set<string>(), runStart: null, heat });
const MAX_HEAT: HeatConfig = { hardLabor: 3, swiftDeath: 3, thickSkin: 3, crowd: 2 };

/** Put the player at the centre of encounter room `i` (world units) + update once so it
 *  activates and its enemies spawn. Returns the first active (non-boss) enemy. */
function activateRoom(s: GameState, i: number): GameState['enemies'][number] | undefined {
  const r = s.rooms[i].rect;
  s.player.x = (r.x + r.w / 2) * s.room.tileSize;
  s.player.y = (r.y + r.h / 2) * s.room.tileSize;
  update(s, idle(), DT);
  return s.enemies.find((e) => e.active && e.type !== 'boss');
}
const firstIdle = (s: GameState): number => s.rooms.findIndex((e) => e.phase === 'idle' && e.spawns.length > 0);

describe('Heat helpers (pure maths)', () => {
  it('NO_HEAT is identity: mults all 1, extra enemies 0, total 0', () => {
    expect(heatStatMults(NO_HEAT)).toEqual({ health: 1, damage: 1, speed: 1 });
    expect(heatExtraEnemies(NO_HEAT)).toBe(0);
    expect(heatTotal(NO_HEAT)).toBe(0);
  });

  it('each rank scales its targeted factor (and only it)', () => {
    expect(heatStatMults({ ...NO_HEAT, thickSkin: 2 })).toEqual({ health: 1 + 2 * HEAT.thickSkinPerRank, damage: 1, speed: 1 });
    expect(heatStatMults({ ...NO_HEAT, hardLabor: 3 })).toEqual({ health: 1, damage: 1 + 3 * HEAT.hardLaborPerRank, speed: 1 });
    expect(heatStatMults({ ...NO_HEAT, swiftDeath: 1 })).toEqual({ health: 1, damage: 1, speed: 1 + HEAT.swiftDeathPerRank });
    expect(heatExtraEnemies({ ...NO_HEAT, crowd: 2 })).toBe(2 * HEAT.crowdPerRank);
  });

  it('heatTotal sums rank × cost; normalizeHeat clamps out-of-range / corrupt ranks', () => {
    expect(heatTotal(MAX_HEAT)).toBe(3 * HEAT.heatPerRankStat * 3 + 2 * HEAT.heatPerRankCrowd);
    expect(normalizeHeat({ hardLabor: 99, swiftDeath: -5, thickSkin: 1.9, crowd: 7 })).toEqual({
      hardLabor: HEAT.maxRankStat,
      swiftDeath: 0,
      thickSkin: 1,
      crowd: HEAT.maxRankCrowd,
    });
    expect(normalizeHeat(null)).toEqual(NO_HEAT);
  });
});

describe('Heat — the L1 sim guards', () => {
  it('⭐ POWER-NEUTRAL (inverted): Heat leaves the PLAYER byte-identical; only enemies harden', () => {
    const base = createGameState(cfg(NO_HEAT));
    const hot = createGameState(cfg(MAX_HEAT));
    // The player is UNTOUCHED by Heat (createPlayer never reads config) — same floor
    // (same default seed) → byte-identical player. If Heat ever touched a player stat,
    // this reds.
    expect(hot.player).toEqual(base.player);

    // ...but the SAME room's enemy is harder under Heat (health/damage/speed all up).
    const i = firstIdle(base);
    const be = activateRoom(base, i)!;
    const he = activateRoom(hot, i)!;
    expect(he.health).toBeGreaterThan(be.health);
    expect(he.attackDamage).toBeGreaterThan(be.attackDamage);
    expect(he.moveSpeed).toBeGreaterThan(be.moveSpeed);
  });

  it('each modifier scales ONLY its targeted enemy value (vs base)', () => {
    const i = firstIdle(createGameState(cfg(NO_HEAT)));
    const base = activateRoom(createGameState(cfg(NO_HEAT)), i)!;

    const thick = activateRoom(createGameState(cfg({ ...NO_HEAT, thickSkin: 3 })), i)!;
    expect(thick.health).toBeCloseTo(base.health * (1 + 3 * HEAT.thickSkinPerRank), 6);
    expect(thick.attackDamage).toBeCloseTo(base.attackDamage, 6); // damage unchanged
    expect(thick.moveSpeed).toBeCloseTo(base.moveSpeed, 6); // speed unchanged

    const hard = activateRoom(createGameState(cfg({ ...NO_HEAT, hardLabor: 2 })), i)!;
    expect(hard.attackDamage).toBeCloseTo(base.attackDamage * (1 + 2 * HEAT.hardLaborPerRank), 6);
    expect(hard.health).toBeCloseTo(base.health, 6);

    const swift = activateRoom(createGameState(cfg({ ...NO_HEAT, swiftDeath: 1 })), i)!;
    expect(swift.moveSpeed).toBeCloseTo(base.moveSpeed * (1 + HEAT.swiftDeathPerRank), 6);
  });

  it('CROWD adds enemies, clamped to the clarity cap + the shared pool', () => {
    const i = firstIdle(createGameState(cfg(NO_HEAT)));
    const baseCount = (() => {
      const s = createGameState(cfg(NO_HEAT));
      activateRoom(s, i);
      return activeEnemyCount(s.enemies);
    })();
    const crowdState = createGameState(cfg({ ...NO_HEAT, crowd: 2 }));
    activateRoom(crowdState, i);
    const crowdCount = activeEnemyCount(crowdState.enemies);
    expect(crowdCount).toBeGreaterThan(baseCount); // more enemies
    expect(crowdCount).toBeLessThanOrEqual(HEAT.maxEnemiesPerRoom); // clarity cap
    expect(crowdCount).toBeLessThanOrEqual(POOL.enemies); // no pool exhaustion
  });

  it('deterministic given (seed, heat): same seed + same Heat → identical enemy stats', () => {
    // Two runs on the SAME seed + SAME Heat config (default-seed createGameState, like
    // the power-neutral test) reproduce byte-identically.
    const a = createGameState(cfg(MAX_HEAT));
    const b = createGameState(cfg(MAX_HEAT));
    const i = firstIdle(a);
    const ea = activateRoom(a, i)!;
    const eb = activateRoom(b, i)!;
    expect(eb.health).toBe(ea.health);
    expect(eb.attackDamage).toBe(ea.attackDamage);
    expect(eb.moveSpeed).toBe(ea.moveSpeed);
    expect(activeEnemyCount(b.enemies)).toBe(activeEnemyCount(a.enemies));
  });

  it('the CROWD clarity cap NEVER nerfs the base count at deep depths (the regression floor holds)', () => {
    // At depth 11+ enemiesPerRoomForDepth already hits POOL.enemies (8) — ABOVE the
    // clarity cap (7). NO_HEAT must still spawn the full base count (8, not 7), and the
    // mix must keep >= 1 chaser. (Regression: an unconditional min(7,...) cut 8→7.)
    const deep = createGameState(cfg(NO_HEAT));
    deep.run.depth = 12;
    regenerate(deep, deep.seed); // rebuild encounters at depth 12
    const i = firstIdle(deep);
    activateRoom(deep, i);
    expect(activeEnemyCount(deep.enemies)).toBe(enemiesPerRoomForDepth(12)); // == base, not capped to 7
    expect(deep.enemies.some((e) => e.active && e.type === 'chaser')).toBe(true); // >= 1 chaser

    // Crowd at deep depth can't exceed the pool (already at the ceiling).
    const deepHot = createGameState(cfg({ ...NO_HEAT, crowd: 2 }));
    deepHot.run.depth = 12;
    regenerate(deepHot, deepHot.seed);
    activateRoom(deepHot, firstIdle(deepHot));
    expect(activeEnemyCount(deepHot.enemies)).toBeLessThanOrEqual(POOL.enemies);
  });
});
