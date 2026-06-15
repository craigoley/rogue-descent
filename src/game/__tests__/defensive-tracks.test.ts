/**
 * The DEFENSIVE BUILD AXIS — two in-run leveled tracks (MAX-HP + DAMAGE-REDUCTION),
 * BASE (always in the pool), filling the all-offense powerup gap. These pin:
 *   - each track levels via applyPickup, capped at POWERUP_MAX_LEVEL.
 *   - DR cuts incoming damage by drPerLevel × level (linear, max 24% at III), applied in
 *     damagePlayer AFTER any Heat scaling (it reduces the `amount` that arrives).
 *   - MAX-HP raises the cap via playerMaxHealth (145 at III) AND heals the added amount on
 *     gain; the cap is the single source of truth for every clamp.
 *   - LEVEL 0 = today EXACTLY (DR mult 1, maxHP 100) — the gameplay regression floor.
 *   - ⭐ THE GUARDRAIL: the finite, scarcity-gated pool means a seeded run CANNOT max both
 *     defensive tracks AND keep a real offensive build — defense COSTS offense (power-neutral
 *     by economy). If the pool were made generous enough to do both, this test REDS.
 *   - the LEAN can target both tracks; deterministic.
 */
import { describe, expect, it } from 'vitest';
import { createGameState } from '../GameState';
import { createPlayer, playerMaxHealth } from '../Player';
import { applyPickup, currentPowerupLevel, leanableKinds, rollDrop, type PickupKind } from '../Pickup';
import { damagePlayer } from '../Combat';
import { enemiesPerRoomForDepth } from '../Difficulty';
import { createRng } from '../../utils/rng';
import { DEFENSE, DROP, HEAT, PLAYER_COMBAT, POWERUP_MAX_LEVEL } from '../../utils/constants';

/** The clearly-offensive leveled tracks — what "a real offensive build" sums over. */
const OFFENSE_KINDS: PickupKind[] = [
  'melee', 'ranged', 'pierce', 'knockback', 'extraCharge',
  'lifesteal', 'burn', 'chain', 'crit',
];
const offenseSum = (p: ReturnType<typeof createPlayer>): number =>
  OFFENSE_KINDS.reduce((n, k) => n + currentPowerupLevel(p, k), 0);

describe('Level 0 = today EXACTLY (the gameplay regression floor)', () => {
  it('a fresh player has both tracks at 0, full damage, base 100 HP cap', () => {
    const p = createPlayer(0, 0);
    expect(p.drLevel).toBe(0);
    expect(p.hpLevel).toBe(0);
    expect(playerMaxHealth(p)).toBe(PLAYER_COMBAT.maxHealth); // 100, unchanged
  });

  it('at drLevel 0 a hit subtracts the FULL amount (no reduction)', () => {
    const s = createGameState();
    s.player.health = 100;
    damagePlayer(s.player, 20, s);
    expect(s.player.health).toBe(80); // 20 × (1 − 0) = 20 lost
  });
});

describe('MAX-HP track — cap + heal-on-gain, capped at III', () => {
  it('playerMaxHealth = 100 + 15 × level (145 at tier III)', () => {
    const p = createPlayer(0, 0);
    for (const [lvl, max] of [[0, 100], [1, 115], [2, 130], [3, 145]] as const) {
      p.hpLevel = lvl;
      expect(playerMaxHealth(p)).toBe(max);
    }
  });

  it('a MAX-HP pickup raises the cap AND heals the +15 delta (felt immediately)', () => {
    const p = createPlayer(0, 0);
    p.health = playerMaxHealth(p); // 100, full
    applyPickup(p, 'maxHp');
    expect(p.hpLevel).toBe(1);
    expect(playerMaxHealth(p)).toBe(115);
    expect(p.health).toBe(115); // healed the +15 so the new pool is felt
  });

  it('caps at POWERUP_MAX_LEVEL — a 4th pickup is a clean no-op (no heal, no over-cap)', () => {
    const p = createPlayer(0, 0);
    for (let i = 0; i < 5; i++) applyPickup(p, 'maxHp');
    expect(p.hpLevel).toBe(POWERUP_MAX_LEVEL); // 3
    expect(playerMaxHealth(p)).toBe(145);
    const hp = p.health;
    applyPickup(p, 'maxHp'); // maxed → delta 0
    expect(p.health).toBe(hp);
  });
});

describe('DAMAGE-REDUCTION track — linear curve, capped, never an off-switch', () => {
  it('cuts incoming damage by 8% per level: 100 dmg → 92 / 84 / 76 lost', () => {
    for (const [lvl, lost] of [[1, 92], [2, 84], [3, 76]] as const) {
      const s = createGameState();
      s.player.health = 200; // headroom so the full hit lands
      s.player.drLevel = lvl;
      damagePlayer(s.player, 100, s);
      expect(s.player.health).toBeCloseTo(200 - lost, 9);
    }
  });

  it('max reduction at tier III is 24% — a LEAN, not immunity', () => {
    expect(DEFENSE.drPerLevel * POWERUP_MAX_LEVEL).toBeCloseTo(0.24, 9);
    expect(DEFENSE.drPerLevel * POWERUP_MAX_LEVEL).toBeLessThan(1); // never zeroes damage
  });

  it('DR applies to the (already Heat-scaled) amount that arrives — mitigates the boosted hit', () => {
    // Heat's Hard Labor scales enemy attackDamage at SPAWN, so `amount` here is already
    // boosted; DR reduces THAT. Simulate a boosted 50 → 30 hit at drLevel 2 (16% off).
    const s = createGameState();
    s.player.health = 100;
    s.player.drLevel = 2;
    const heatBoosted = 50;
    damagePlayer(s.player, heatBoosted, s);
    expect(s.player.health).toBeCloseTo(100 - heatBoosted * (1 - 0.16), 9); // 100 − 42 = 58
  });

  it('caps at POWERUP_MAX_LEVEL (a 4th pickup is a no-op)', () => {
    const p = createPlayer(0, 0);
    for (let i = 0; i < 5; i++) applyPickup(p, 'damageReduction');
    expect(p.drLevel).toBe(POWERUP_MAX_LEVEL);
  });
});

describe('Meta interactions — lean + carry', () => {
  it('both defensive tracks are LEANABLE in the base config (the lean can target them)', () => {
    const kinds = leanableKinds(); // base (no unlocks)
    expect(kinds).toContain('maxHp');
    expect(kinds).toContain('damageReduction');
  });

  it('both tracks are in the BASE drop pool (reachable without any unlock)', () => {
    const rng = createRng(12345);
    const seen = new Set<PickupKind | null>();
    for (let i = 0; i < 6000; i++) seen.add(rollDrop(rng)); // base pool
    expect(seen.has('maxHp')).toBe(true);
    expect(seen.has('damageReduction')).toBe(true);
  });
});

/**
 * ⭐ THE GUARDRAIL — power-neutrality by economy. Simulate a GENEROUS winning run's drop
 * supply (the real difficulty curve, floors 1..W × a generous rooms/floor), auto-collecting
 * every drop through the SAME scarcity-acceptance gate the game uses, and prove you can't end
 * up "tanky AND high-offense". The finite, scarcity-gated pool forbids it: choosing defense
 * costs offense.
 */
describe('⭐ Guardrail — the finite pool can NOT make you tanky AND loaded on offense', () => {
  // A generous-but-realistic winning run: clear most rooms over the 8-floor descent to the
  // win depth. Kills grounded in the real enemy-count curve (≈360 over the run) — this is the
  // SUPPLY of drop rolls a run gives. (A more thorough run gives a bit more; a focused one less.)
  const ROOMS_PER_FLOOR = 10;
  const SEEDS = 40;
  /** Total kills across the winning run, from the actual per-depth enemy curve. */
  function runKills(): number {
    let kills = 0;
    for (let d = 1; d <= HEAT.unlockDepth; d++) kills += enemiesPerRoomForDepth(d) * ROOMS_PER_FLOOR;
    return kills;
  }
  /** Auto-collect a seeded run's drops (rollDrop + the scarcity-accept gate) under an optional
   *  LEAN — the BEST case for stacking a direction, since floor drops are auto-applied (no skip).
   *  Mirrors rollAndSpawnDrop's accept gate economically. */
  function simulateRun(seed: number, lean: PickupKind | null): ReturnType<typeof createPlayer> {
    const rng = createRng(seed);
    const p = createPlayer(0, 0);
    const kills = runKills();
    for (let i = 0; i < kills; i++) {
      const kind = rollDrop(rng, undefined, lean); // base pool (no unlocks)
      if (!kind || kind === 'health') continue;
      const accept = DROP.powerupAcceptByLevel[currentPowerupLevel(p, kind)];
      if (rng.next() < accept) applyPickup(p, kind);
    }
    return p;
  }
  const defenseSum = (p: ReturnType<typeof createPlayer>): number => p.hpLevel + p.drLevel;

  it('SCARCITY: a run acquires only a fraction of the levels needed to max the pool', () => {
    // 11 base leveled tracks × 3 = 33 levels to max everything. The scarcity-gated finite supply
    // averages far below that — you build a SUBSET, never the whole board.
    let total = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const p = simulateRun(seed, null);
      total += defenseSum(p) + offenseSum(p) + (p.fasterRecharge ? 1 : 0) + (p.dashStrike ? 1 : 0);
    }
    const avg = total / SEEDS;
    expect(avg).toBeLessThan(18); // ≈12 in practice; comfortably under the 33-level "max all"
  });

  it('NO ALL-IN-BOTH: you never end a realistic run BOTH fully tanky AND loaded on offense', () => {
    // Fully tanky = both defensive tracks maxed (hp 3 + dr 3). Loaded offense = >= 9 offensive
    // levels (three maxed offensive tracks). The finite, scarcity-gated pool forbids having both
    // — even leaning ALL-IN on a defensive track. ⚠️ if the pool were made generous enough to
    // stack both, this REDS (the curve-flattener tripwire).
    const LOADED_OFFENSE = 9;
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const lean of ['maxHp', 'damageReduction', null] as (PickupKind | null)[]) {
        const p = simulateRun(seed, lean);
        const fullyTanky = p.hpLevel === POWERUP_MAX_LEVEL && p.drLevel === POWERUP_MAX_LEVEL;
        expect(fullyTanky && offenseSum(p) >= LOADED_OFFENSE).toBe(false);
      }
    }
  });

  it('the LEAN is a real, power-neutral TRADEOFF: leaning defense raises defense, lowers offense', () => {
    // Aggregate over seeds: a defense-lean run carries MORE defensive levels and FEWER offensive
    // levels than an offense-lean run — the steer redirects the SAME finite supply (a build
    // DIRECTION), it never adds power. This is the neutrality proof.
    let defLeanDefense = 0, defLeanOffense = 0, offLeanDefense = 0, offLeanOffense = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const d = simulateRun(seed, 'maxHp');
      const o = simulateRun(seed, 'melee');
      defLeanDefense += defenseSum(d);
      defLeanOffense += offenseSum(d);
      offLeanDefense += defenseSum(o);
      offLeanOffense += offenseSum(o);
    }
    expect(defLeanDefense).toBeGreaterThan(offLeanDefense); // defense lean → more defense
    expect(defLeanOffense).toBeLessThan(offLeanOffense); // ...at the cost of offense (the tradeoff)
  });

  it('is deterministic — same seed + lean => identical build', () => {
    const a = simulateRun(99, 'damageReduction');
    const b = simulateRun(99, 'damageReduction');
    expect({ hp: a.hpLevel, dr: a.drLevel, off: offenseSum(a) }).toEqual({
      hp: b.hpLevel, dr: b.drLevel, off: offenseSum(b),
    });
  });
});
