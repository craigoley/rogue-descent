/**
 * L1 integration — INVARIANT FUZZ. A broad cheap safety net: drive the real loop
 * for K frames with deterministic, seeded pseudo-random input and assert the
 * sim's hard invariants hold every frame — no exception, finite positions, health
 * in [0, max], and the fixed pools never overflow. Several seeds. Catches the
 * class of regression a targeted test would miss (NaN drift, runaway spawns, an
 * unhandled state combo). Fully deterministic: inputs come from a seeded Rng, not
 * Math.random / wall-clock.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startNewRun, update, type GameState } from '../GameState';
import { activeEnemyCount } from '../Enemy';
import { activeProjectileCount } from '../Projectile';
import { activeEnemyProjectileCount } from '../EnemyProjectile';
import { activePickupCount } from '../Pickup';
import { createRng } from '../../utils/rng';
import { POOL, SIM_DT } from '../../utils/constants';
import { playerMaxHealth } from '../Player';
import { intent } from './l1-harness';

const DT = SIM_DT;
const FRAMES = 600; // ~10s of sim per seed

function assertInvariants(s: GameState): void {
  const p = s.player;
  expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true); // no NaN/Infinity drift
  expect(p.health).toBeGreaterThanOrEqual(0); // death clamps to 0
  expect(p.health).toBeLessThanOrEqual(playerMaxHealth(p)); // pickups clamp to actual max (MAX-HP track may raise it)
  for (const e of s.enemies) {
    if (e.active) expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
  }
  // Fixed pools never overflow (bounded object pools — a CLAUDE.md hard rule).
  expect(activeEnemyCount(s.enemies)).toBeLessThanOrEqual(POOL.enemies);
  expect(activeProjectileCount(s.projectiles)).toBeLessThanOrEqual(POOL.projectiles);
  expect(activeEnemyProjectileCount(s.enemyProjectiles)).toBeLessThanOrEqual(POOL.enemyProjectiles);
  expect(activePickupCount(s.pickups)).toBeLessThanOrEqual(POOL.pickups);
}

/** Run one seeded fuzz session, asserting invariants every frame. Floor geometry
 *  is seeded by `seed`; the input stream is a SEPARATE derived stream so movement
 *  doesn't correlate with the layout. Throws (failing the test) on any violation
 *  or any exception out of update(). */
function fuzz(seed: number): void {
  const s = createGameState();
  startNewRun(s, seed);
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  for (let f = 0; f < FRAMES; f++) {
    update(
      s,
      intent({
        moveX: rng.int(-1, 1),
        moveY: rng.int(-1, 1),
        aimX: rng.next() * 2 - 1,
        aimY: rng.next() * 2 - 1,
        melee: rng.next() < 0.15,
        dash: rng.next() < 0.08,
        ranged: rng.next() < 0.25,
      }),
      DT,
    );
    assertInvariants(s);
  }
}

describe('L1 integration: invariant fuzz (seeded input)', () => {
  for (const seed of [1, 7, 42, 1337]) {
    it(`seed ${seed}: ${FRAMES} frames hold every invariant (no throw / NaN / overflow)`, () => {
      fuzz(seed); // direct call -> an exception or a failed invariant reports precisely
    });
  }
});
