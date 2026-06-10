/**
 * SYNERGY ARC — PR4 CRIT (the finale; the "multiplier glue"). Pins the contract:
 *   - A direct hit at critLevel>=1 has a combatRng chance to deal ×multiplier; the
 *     roll is rolled inside damageEnemy on the 'direct' kind. Deterministic here via a
 *     STUBBED combatRng (always-crit / never-crit), exactly as the drop tests stub
 *     dropRng.
 *   - COMPOSITION (the point — crit isn't a flat number): a crit spikes the chain base
 *     (arcs scale from it) and the lifesteal heal, FREE. The burn DoT is NOT pumped
 *     (scope call — burnDps stays level-based).
 *   - INDEPENDENCE: combatRng is a separate stream from dropRng → crit activity does
 *     NOT shift drop sequences (so no drop-test perturbation from the rng).
 *   - level 0 = never crits (gated → no combatRng draw → base damage).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startNewRun, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import { buildTestRoom, roomCenter } from '../Room';
import { spawnEnemy } from '../Enemy';
import { rollDrop } from '../Pickup';
import { damageEnemy } from '../Combat';
import { BURN_LEVELS, CRIT, CRIT_LEVELS, LIFESTEAL_LEVELS, SIM_DT } from '../../utils/constants';
import type { Rng } from '../../utils/rng';

void SIM_DT;

/** A combatRng stub returning a fixed value (mirrors the drop-test dropRng stubs).
 *  0 → always crit (0 < any chance); 0.99 → never crit (≥ max chance 0.30). */
function fixedRng(v: number): Rng {
  return { next: () => v, int: () => 0 };
}

function arena(): GameState {
  const s = createGameState();
  s.room = buildTestRoom();
  const c = roomCenter(s.room);
  s.spawn = { x: c.x, y: c.y };
  s.player = createPlayer(c.x, c.y);
  for (const e of s.enemies) e.active = false;
  s.rooms = [];
  s.activeRoom = -1;
  return s;
}

function enemyAt(s: GameState, x: number, y: number) {
  spawnEnemy(s.enemies, x, y);
  const e = s.enemies.filter((en) => en.active).at(-1)!; // the just-spawned one (not the first active)
  e.health = 10_000;
  return e;
}

describe('Crit — the multiply (deterministic via a stubbed combatRng)', () => {
  it('a guaranteed crit deals ×multiplier; a guaranteed non-crit deals base', () => {
    const critS = arena();
    critS.player.critLevel = 3;
    critS.combatRng = fixedRng(0); // always crit
    const e1 = enemyAt(critS, critS.player.x + 1, critS.player.y);
    damageEnemy(e1, 100, 1, 0, 0, critS);
    expect(10_000 - e1.health).toBe(100 * CRIT_LEVELS.multiplier);

    const noS = arena();
    noS.player.critLevel = 3;
    noS.combatRng = fixedRng(0.99); // never crit
    const e2 = enemyAt(noS, noS.player.x + 1, noS.player.y);
    damageEnemy(e2, 100, 1, 0, 0, noS);
    expect(10_000 - e2.health).toBe(100);
  });

  it('a crit sets critFlashTimer (the PR-3 flare); a non-crit hit leaves it 0 (crit-exclusive)', () => {
    const critS = arena();
    critS.player.critLevel = 3;
    critS.combatRng = fixedRng(0); // always crit
    const e1 = enemyAt(critS, critS.player.x + 1, critS.player.y);
    expect(e1.critFlashTimer).toBe(0); // not set before the hit
    damageEnemy(e1, 100, 1, 0, 0, critS);
    expect(e1.critFlashTimer).toBe(CRIT.flashDuration); // the crit armed the flare

    const noS = arena();
    noS.player.critLevel = 3;
    noS.combatRng = fixedRng(0.99); // never crit
    const e2 = enemyAt(noS, noS.player.x + 1, noS.player.y);
    damageEnemy(e2, 100, 1, 0, 0, noS);
    expect(e2.flashTimer).toBeGreaterThan(0); // a normal hit still flashes
    expect(e2.critFlashTimer).toBe(0); // ...but NOT the crit flare
  });

  it('level 0 NEVER crits (gated → no draw → base), even with an always-crit rng', () => {
    const s = arena();
    s.player.critLevel = 0;
    s.combatRng = fixedRng(0); // would crit if it rolled
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 100, 1, 0, 0, s);
    expect(10_000 - e.health).toBe(100); // base — the roll is gated out
  });
});

describe('Crit — composition (spikes the other axes, free)', () => {
  it('crit spikes the CHAIN base → arcs scale from the bigger hit', () => {
    const s = arena();
    s.player.critLevel = 3;
    s.player.chainLevel = 1;
    s.combatRng = fixedRng(0); // always crit
    const origin = enemyAt(s, 20, 20);
    const neighbour = enemyAt(s, 21, 20); // within chain range
    damageEnemy(origin, 100, 1, 0, 0, s);
    // Arc base = the crit-boosted dmg (200); first hop = 200 × falloff.
    expect(10_000 - neighbour.health).toBeCloseTo(100 * CRIT_LEVELS.multiplier * 0.6, 4);
  });

  it('crit spikes the LIFESTEAL heal (×multiplier, under the per-hit cap)', () => {
    const s = arena();
    s.player.critLevel = 3;
    s.player.lifestealLevel = 1; // frac 0.04 → 100 dmg heals 4; a crit heals 8 (both < cap 12)
    s.player.health = 50;
    s.combatRng = fixedRng(0);
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 100, 1, 0, 0, s);
    const expected = Math.min(100 * CRIT_LEVELS.multiplier * LIFESTEAL_LEVELS.frac[1], LIFESTEAL_LEVELS.maxPerHit);
    expect(s.player.health - 50).toBeCloseTo(expected, 5);
  });

  it('crit does NOT pump the BURN DoT (burnDps stays level-based — the scope call)', () => {
    const s = arena();
    s.player.critLevel = 3;
    s.player.burnLevel = 2;
    s.combatRng = fixedRng(0); // crit the direct hit
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 100, 1, 0, 0, s);
    expect(e.burnDps).toBe(BURN_LEVELS.dps[2]); // NOT ×multiplier
  });
});

describe('Crit — combatRng is independent of dropRng', () => {
  it('crit activity does NOT shift the drop sequence (separate streams)', () => {
    const SEED = 24601;
    const a = createGameState();
    startNewRun(a, SEED);
    const dropsA = Array.from({ length: 25 }, () => rollDrop(a.dropRng));

    const b = createGameState();
    startNewRun(b, SEED);
    b.player.critLevel = 3; // draws combatRng on every direct hit below
    b.room = buildTestRoom();
    for (const e of b.enemies) e.active = false;
    const e = enemyAt(b, 20, 20);
    for (let i = 0; i < 50; i++) {
      e.health = 10_000;
      damageEnemy(e, 50, 1, 0, 0, b); // advances combatRng, never dropRng
    }
    const dropsB = Array.from({ length: 25 }, () => rollDrop(b.dropRng));

    expect(dropsB).toEqual(dropsA); // dropRng untouched by crit rolls
  });
});

describe('Crit — carry + reset', () => {
  it('a new run resets critLevel to 0', () => {
    const s = createGameState();
    s.player.critLevel = 3;
    startNewRun(s, 777);
    expect(s.player.critLevel).toBe(0);
  });
});
