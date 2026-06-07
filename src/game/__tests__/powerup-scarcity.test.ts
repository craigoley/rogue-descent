/**
 * Per-level powerup SCARCITY (Phase 9, lever iii-b). A rolled powerup is accepted
 * with DROP.powerupAcceptByLevel[currentLevel] — so reaching tier III is EARNED
 * without a stingy entry: level 0 always accepts (build entry quick), higher
 * levels are increasingly rejected, a maxed track / owned binary never spawns
 * (no wasted drop). A reject = no spawn (post-roll filter beside the #51 health
 * suppression). Health is unaffected. Replaces the decay idea.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { rollDrop, currentPowerupLevel, activePickupCount } from '../Pickup';
import { rollAndSpawnDrop } from '../Encounter';
import { DROP } from '../../utils/constants';
import type { Rng } from '../../utils/rng';

/** Rng returning a fixed sequence from next() (last value repeats). */
function seqRng(values: number[]): Rng {
  let i = 0;
  return { next: () => values[Math.min(i++, values.length - 1)], int: () => 0 };
}

/** A roll-stream that yields `kind` from rollDrop, then `acceptDraw` for the
 *  scarcity gate. rollDrop: [chance-gate, health-gate, kind-pick]; then the
 *  scarcity reject consumes one more draw. */
function rollThenAccept(kindPick: number, acceptDraw: number): Rng {
  // under chance (drop), at/above healthShare (powerup), kindPick selects the kind,
  // then acceptDraw is the scarcity gate.
  return seqRng([0, DROP.healthShare, kindPick, acceptDraw]);
}

/** Fresh state, pickups emptied, player HURT (so health drops aren't full-HP
 *  suppressed) + in an active room. */
function arena(): GameState {
  const s = createGameState();
  for (const pk of s.pickups) pk.active = false;
  s.player.health = 1; // well below the full-HP suppression line
  s.activeRoom = 0;
  return s;
}

/** The kind-pick fraction that lands on POWERUP_KINDS index k under the WEIGHTED
 *  roll (synergy arc): stat-tracks (indices 0..6) weight DROP.trackWeight, the
 *  effect axes 'lifesteal' (7) + 'burn' (8) weight DROP.effectWeight. Mirrors
 *  rollDrop's cumulative-weight walk; returns the midpoint fraction of index k's band. */
const KIND_WEIGHTS = [
  DROP.trackWeight, // melee
  DROP.trackWeight, // ranged
  DROP.trackWeight, // pierce
  DROP.trackWeight, // knockback
  DROP.trackWeight, // extraCharge
  DROP.trackWeight, // fasterRecharge
  DROP.trackWeight, // dashStrike
  DROP.effectWeight, // lifesteal (effect axis)
  DROP.effectWeight, // burn (effect axis)
];
const WEIGHT_TOTAL = KIND_WEIGHTS.reduce((a, b) => a + b, 0);
const pickFor = (k: number): number => {
  let cum = 0;
  for (let i = 0; i < k; i++) cum += KIND_WEIGHTS[i];
  return (cum + KIND_WEIGHTS[k] / 2) / WEIGHT_TOTAL;
};

describe('rollDrop stays pure (rng-only, unchanged)', () => {
  it('same rng sequence => same result, no player state involved', () => {
    expect(rollDrop(seqRng([0, DROP.healthShare, pickFor(0)]))).toBe('melee');
    expect(rollDrop(seqRng([DROP.chance, 0]))).toBeNull();
    expect(rollDrop(seqRng([0, 0]))).toBe('health');
  });
});

describe('currentPowerupLevel — maps kind -> level', () => {
  it('leveled tracks return their int level; binaries map owned->max, unowned->0', () => {
    const s = createGameState();
    s.player.meleeLevel = 2;
    expect(currentPowerupLevel(s.player, 'melee')).toBe(2);
    expect(currentPowerupLevel(s.player, 'dashStrike')).toBe(0); // unowned
    s.player.dashStrike = true;
    expect(currentPowerupLevel(s.player, 'dashStrike')).toBe(DROP.powerupAcceptByLevel.length - 1); // maxed
    expect(currentPowerupLevel(s.player, 'health')).toBe(0);
  });
});

describe('Level-gated acceptance — entry quick, maxing earned', () => {
  it('level 0 ALWAYS accepts (build entry stays quick)', () => {
    const s = arena(); // meleeLevel 0
    // accept[0] = 1.0, so even an acceptDraw of 0.999 spawns.
    rollAndSpawnDrop(s, 5, 5, rollThenAccept(pickFor(0), 0.999));
    expect(activePickupCount(s.pickups)).toBe(1);
  });

  it('II->III accepts below the rate, rejects at/above it', () => {
    const accept = DROP.powerupAcceptByLevel[2]; // 0.3
    // Just below -> spawn.
    const a = arena();
    a.player.meleeLevel = 2;
    rollAndSpawnDrop(a, 5, 5, rollThenAccept(pickFor(0), accept - 0.01));
    expect(activePickupCount(a.pickups)).toBe(1);
    // At/above -> reject (no spawn).
    const b = arena();
    b.player.meleeLevel = 2;
    rollAndSpawnDrop(b, 5, 5, rollThenAccept(pickFor(0), accept));
    expect(activePickupCount(b.pickups)).toBe(0);
  });

  it('a MAXED track never spawns (accept 0 -> always rejected, no wasted drop)', () => {
    const s = arena();
    s.player.meleeLevel = 3;
    rollAndSpawnDrop(s, 5, 5, rollThenAccept(pickFor(0), 0)); // even draw 0 rejects (>= 0)
    expect(activePickupCount(s.pickups)).toBe(0);
  });
});

describe('Binary powerups — unowned accepts, owned rejected (dead-repeat fix)', () => {
  // 'dashStrike' is POWERUP_KINDS index 6.
  const DASHSTRIKE = pickFor(6);

  it('unowned binary accepts (level 0)', () => {
    const s = arena();
    expect(s.player.dashStrike).toBe(false);
    rollAndSpawnDrop(s, 5, 5, rollThenAccept(DASHSTRIKE, 0.999));
    expect(activePickupCount(s.pickups)).toBe(1);
  });

  it('owned binary is rejected (reads as maxed)', () => {
    const s = arena();
    s.player.dashStrike = true;
    rollAndSpawnDrop(s, 5, 5, rollThenAccept(DASHSTRIKE, 0));
    expect(activePickupCount(s.pickups)).toBe(0);
  });
});

describe('Health is unaffected by the level filter', () => {
  it('a health drop while hurt spawns regardless of weapon levels', () => {
    const s = arena(); // health = 1 (hurt)
    s.player.meleeLevel = 3; // maxed weapon must not affect health
    rollAndSpawnDrop(s, 5, 5, seqRng([0, 0])); // rollDrop -> 'health'; no accept draw consumed
    expect(activePickupCount(s.pickups)).toBe(1);
  });
});
