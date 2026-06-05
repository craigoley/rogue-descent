/**
 * Drop-frequency tuning. Pins the two "fewer / more meaningful drops" levers:
 *   - rollDrop reads DROP.chance + DROP.healthShare (the rate + health weighting).
 *   - rollAndSpawnDrop SUPPRESSES a rolled health drop at/above
 *     DROP.healthSuppressAboveFrac of max HP (useless-at-full health is litter),
 *     while still spawning powerups and low-HP health. The suppression is a
 *     post-roll HP filter — the rng roll itself is unchanged (seed-deterministic).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { rollDrop, activePickupCount } from '../Pickup';
import { rollAndSpawnDrop } from '../Encounter';
import { DROP, PLAYER_COMBAT } from '../../utils/constants';
import type { Rng } from '../../utils/rng';

/** An Rng that returns a fixed sequence from next() (last value repeats). int()
 *  is unused by rollDrop. Lets us force a specific roll outcome. */
function seqRng(values: number[]): Rng {
  let i = 0;
  return {
    next: () => values[Math.min(i++, values.length - 1)],
    int: () => 0,
  };
}

describe('rollDrop — rate + type weighting read the constants', () => {
  it('rolls nothing when the chance gate fails (>= DROP.chance)', () => {
    expect(rollDrop(seqRng([DROP.chance, 0]))).toBeNull(); // exactly at the threshold -> null
    expect(rollDrop(seqRng([DROP.chance + 0.0001, 0]))).toBeNull();
  });

  it('rolls HEALTH when under chance and under the health share', () => {
    expect(rollDrop(seqRng([DROP.chance - 0.0001, DROP.healthShare - 0.0001]))).toBe('health');
  });

  it('rolls a POWERUP when under chance but at/above the health share', () => {
    const kind = rollDrop(seqRng([0, DROP.healthShare, 0]));
    expect(kind).not.toBeNull();
    expect(kind).not.toBe('health'); // the rest of the drops are powerups
  });
});

describe('rollAndSpawnDrop — health suppressed at/above near-full HP', () => {
  const forceHealth = () => seqRng([0, 0]); // under chance + under health share -> 'health'
  const forcePowerup = () => seqRng([0, DROP.healthShare]); // under chance, NOT health -> powerup
  const thresh = PLAYER_COMBAT.maxHealth * DROP.healthSuppressAboveFrac;

  function freshAwayFromPickups(): GameState {
    const s = createGameState();
    for (const pk of s.pickups) pk.active = false;
    return s;
  }

  it('does NOT spawn a health drop at full HP (useless litter suppressed)', () => {
    const s = freshAwayFromPickups();
    s.player.health = PLAYER_COMBAT.maxHealth;
    rollAndSpawnDrop(s, 5, 5, forceHealth());
    expect(activePickupCount(s.pickups)).toBe(0);
  });

  it('DOES spawn a health drop when hurt (below the threshold)', () => {
    const s = freshAwayFromPickups();
    s.player.health = thresh - 1; // just below the suppress line
    rollAndSpawnDrop(s, 5, 5, forceHealth());
    expect(activePickupCount(s.pickups)).toBe(1);
  });

  it('suppresses exactly at the threshold (uses the constant, not a literal)', () => {
    const s = freshAwayFromPickups();
    s.player.health = thresh; // at the line -> suppressed (>=)
    rollAndSpawnDrop(s, 5, 5, forceHealth());
    expect(activePickupCount(s.pickups)).toBe(0);
  });

  it('still spawns POWERUP drops at full HP (suppression is health-only)', () => {
    const s = freshAwayFromPickups();
    s.player.health = PLAYER_COMBAT.maxHealth;
    rollAndSpawnDrop(s, 5, 5, forcePowerup());
    expect(activePickupCount(s.pickups)).toBe(1);
  });
});
