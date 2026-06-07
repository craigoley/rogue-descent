/**
 * L1 integration scenario (c) — per-level powerup SCARCITY, aggregated over many
 * seeded rolls through rollAndSpawnDrop (the real drop path). Mirrors the unit
 * proofs in powerup-scarcity.test (#55); this asserts the emergent THINNING at the
 * roll-stream level: higher-level tracks accept far fewer drops, a maxed track
 * never spawns, owned binaries never re-drop. Deterministic (fixed seed; the
 * accept gate consumes one rng draw regardless of level, so the roll SEQUENCE is
 * identical across settings — only accept/reject differs).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { rollAndSpawnDrop } from '../Encounter';
import { createRng } from '../../utils/rng';

const SEED = 0xc0ffee;
const N = 600;
/** The leveled weapon/charge tracks (the ones the scarcity gate scales by level).
 *  Binaries (fasterRecharge/dashStrike) are excluded — they're level 0/unowned
 *  here so they always accept and would be constant noise. */
const LEVELED = new Set(['melee', 'ranged', 'pierce', 'knockback', 'extraCharge']);

/** Set every LEVELED powerup track to `lvl` (so any powerup roll hits that level). */
function setAllLevels(s: GameState, lvl: number): void {
  s.player.meleeLevel = lvl;
  s.player.rangedLevel = lvl;
  s.player.pierceLevel = lvl;
  s.player.knockbackLevel = lvl;
  s.player.extraChargeLevel = lvl;
}

/** Roll N drops with a fresh seeded stream; return how many LEVELED-track drops
 *  actually spawned (the ones the scarcity gate scales). Pickups are deactivated
 *  each iteration so the pool (16) never fills and caps the count. */
function countPowerupSpawns(s: GameState, n: number): number {
  s.player.health = 1; // hurt -> health drops aren't full-HP-suppressed (isolate powerups)
  s.dropRng = createRng(SEED);
  s.activeRoom = -1;
  let count = 0;
  for (let i = 0; i < n; i++) {
    rollAndSpawnDrop(s, 5, 5, s.dropRng);
    for (const pk of s.pickups) {
      if (!pk.active) continue;
      if (LEVELED.has(pk.kind)) count++;
      pk.active = false;
    }
  }
  return count;
}

describe('L1 integration: powerup scarcity thinning (#55 end-to-end)', () => {
  it('a high-level track accepts FAR fewer drops than a fresh one', () => {
    const at0 = countPowerupSpawns((() => { const s = createGameState(); setAllLevels(s, 0); return s; })(), N);
    const at2 = countPowerupSpawns((() => { const s = createGameState(); setAllLevels(s, 2); return s; })(), N);
    expect(at0).toBeGreaterThan(0); // fresh tracks supply a build
    expect(at2).toBeGreaterThan(0); // II still occasionally tops up
    expect(at2).toBeLessThan(at0); // ...but FAR fewer — growth is thinned
    expect(at2).toBeLessThan(at0 * 0.75); // a real gap, not noise (II accept 0.6 vs 1.0)
  });

  it('a MAXED track never spawns a powerup (accept 0)', () => {
    const s = createGameState();
    setAllLevels(s, 3); // every leveled track at the cap
    expect(countPowerupSpawns(s, N)).toBe(0); // not one powerup drop in N rolls
  });

  it('an OWNED binary powerup never re-drops (the dead-repeat fix)', () => {
    const s = createGameState();
    setAllLevels(s, 0); // leveled tracks accept...
    s.player.fasterRecharge = true; // ...but owned binaries must be rejected
    s.player.dashStrike = true;
    s.player.health = 1;
    s.dropRng = createRng(SEED);
    s.activeRoom = -1;
    let spawnedFasterRecharge = 0;
    let spawnedDashStrike = 0;
    let spawnedOther = 0;
    for (let i = 0; i < N; i++) {
      rollAndSpawnDrop(s, 5, 5, s.dropRng);
      for (const pk of s.pickups) {
        if (!pk.active) continue;
        if (pk.kind === 'fasterRecharge') spawnedFasterRecharge++;
        else if (pk.kind === 'dashStrike') spawnedDashStrike++;
        else if (pk.kind !== 'health') spawnedOther++;
        pk.active = false;
      }
    }
    expect(spawnedFasterRecharge).toBe(0); // owned -> rejected
    expect(spawnedDashStrike).toBe(0); // owned -> rejected
    expect(spawnedOther).toBeGreaterThan(0); // the un-owned leveled tracks still drop
  });
});
