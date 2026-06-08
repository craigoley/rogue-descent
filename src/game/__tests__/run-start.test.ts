/**
 * META LAYER 2 — the RUN-START LEAN (config.runStart). Pins the power-neutrality
 * invariant + the felt mechanic:
 *   ⭐ POWER-NEUTRAL (the headline): over a fixed roll sequence the TOTAL powerups is
 *      IDENTICAL leaned vs unleaned — the lean shifts only the KIND histogram, never the
 *      count (the weighted walk consumes one rng draw either way → no stream desync, the
 *      difficulty curve can't degrade). count invariant; distribution variant.
 *   - GUARANTEED-FIRST: a leaned run's FIRST spawned powerup IS the lean kind (relabelled,
 *     not added — so still count-neutral).
 *   - WEIGHTING: the lean kind is rolled MORE often than without the lean.
 *   - DETERMINISTIC given (seed, lean).
 *   - LEANABLE set = available leveled kinds (grows with unlocks); base / No-Lean = today.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type RunConfig } from '../GameState';
import { rollDrop, leanableKinds, activePickupCount } from '../Pickup';
import { rollAndSpawnDrop } from '../Encounter';
import { createRng } from '../../utils/rng';

const SEED = 0xc0ffee;

/** Roll a fixed-length drop sequence; return the powerup COUNT (non-null, non-health)
 *  and the per-kind histogram. rollDrop is pure → deterministic per (seed, lean). */
function powerupRolls(seed: number, lean: string | null): { count: number; hist: Record<string, number> } {
  const rng = createRng(seed);
  const hist: Record<string, number> = {};
  let count = 0;
  for (let i = 0; i < 3000; i++) {
    const k = rollDrop(rng, new Set(), lean);
    if (k && k !== 'health') {
      count++;
      hist[k] = (hist[k] ?? 0) + 1;
    }
  }
  return { count, hist };
}

describe('Run-start lean — ⭐ power-neutrality (count invariant, distribution variant)', () => {
  it('total powerups is IDENTICAL leaned vs unleaned — only the kind histogram shifts', () => {
    const base = powerupRolls(SEED, null);
    const leaned = powerupRolls(SEED, 'burn');
    expect(leaned.count).toBe(base.count); // ⭐ the headline: count unchanged → no power added
    // ...but the distribution moved toward the lean.
    expect(leaned.hist.burn).toBeGreaterThan(base.hist.burn ?? 0);
  });

  it('the leaned kind is rolled MORE often than any other (the weighting lands)', () => {
    const leaned = powerupRolls(SEED, 'burn');
    const others = Object.entries(leaned.hist).filter(([k]) => k !== 'burn');
    for (const [, n] of others) expect(leaned.hist.burn).toBeGreaterThanOrEqual(n);
  });

  it('is deterministic given (seed, lean)', () => {
    expect(powerupRolls(SEED, 'crit')).toEqual(powerupRolls(SEED, 'crit'));
  });

  it('No-Lean (null) is byte-identical to the pre-lean roll stream (today exactly)', () => {
    // rollDrop with no lean must consume + return exactly as the 2-arg form did.
    const a = createRng(SEED);
    const b = createRng(SEED);
    for (let i = 0; i < 500; i++) expect(rollDrop(a, new Set(), null)).toBe(rollDrop(b, new Set()));
  });
});

describe('Run-start lean — guaranteed first powerup', () => {
  const firstSpawnedKind = (lean: string | null): string => {
    const s = createGameState({ unlocked: new Set<string>(), runStart: lean });
    const rng = createRng(424242);
    for (let i = 0; i < 8000; i++) {
      const before = activePickupCount(s.pickups);
      rollAndSpawnDrop(s, 0, 0, rng);
      if (activePickupCount(s.pickups) > before) return s.pickups.find((p) => p.active)!.kind;
    }
    throw new Error('no powerup spawned');
  };

  it('a leaned run guarantees the lean kind as the FIRST powerup surfaced', () => {
    expect(firstSpawnedKind('burn')).toBe('burn');
    expect(firstSpawnedKind('lifesteal')).toBe('lifesteal'); // works for any lean, not a fluke
  });

  it('delivers it once (the run flag flips) and No-Lean forces nothing', () => {
    const s = createGameState({ unlocked: new Set<string>(), runStart: 'crit' });
    const rng = createRng(7);
    let guard = 0;
    while (activePickupCount(s.pickups) === 0 && guard++ < 8000) rollAndSpawnDrop(s, 0, 0, rng);
    expect(s.run.leanFirstDelivered).toBe(true);
    // No-Lean: the flag never sets (nothing is forced).
    const n = createGameState({ unlocked: new Set<string>(), runStart: null });
    const rng2 = createRng(7);
    for (let i = 0; i < 50; i++) rollAndSpawnDrop(n, 0, 0, rng2);
    expect(n.run.leanFirstDelivered).toBe(false);
  });
});

describe('Run-start lean — the leanable set (Layer 1↔2 tie)', () => {
  it('base = available leveled kinds; excludes locked + binary toggles + health', () => {
    const base = leanableKinds(new Set());
    expect(base).toContain('burn'); // base effect
    expect(base).toContain('melee'); // stat track
    expect(base).not.toContain('freeze'); // locked (not unlocked)
    expect(base).not.toContain('fireRate'); // locked
    expect(base).not.toContain('fasterRecharge'); // binary toggle — not a leanable direction
    expect(base).not.toContain('dashStrike');
    expect(base as string[]).not.toContain('health');
  });

  it('unlocking EXPANDS the lean menu (freeze/fireRate join once unlocked)', () => {
    const unlocked = leanableKinds(new Set(['freeze', 'fireRate']));
    expect(unlocked).toContain('freeze');
    expect(unlocked).toContain('fireRate');
  });

  it('createGameState carries the lean on config.runStart (base default = null)', () => {
    const leaned: RunConfig = { unlocked: new Set<string>(), runStart: 'chain' };
    expect(createGameState(leaned).config.runStart).toBe('chain');
    expect(createGameState().config.runStart).toBeNull();
  });
});
