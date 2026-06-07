/**
 * SYNERGY ARC — PR1 LIFESTEAL. Pins the contract:
 *   - A DIRECT hit heals the player by damage × frac[level], capped per hit
 *     (maxPerHit) and clamped to max HP. No heal at full HP or at level 0.
 *   - It hooks the SHARED damageEnemy choke point, so it AUTO-MULTIPLIES with the
 *     existing tracks: a pierce shot through N enemies = N damageEnemy calls = N
 *     heals (the emergent-synergy spine — proven here via pierce; multishot is the
 *     same N-calls mechanism).
 *   - BOUND (decision E): damage-over-time / TICK damage (isDirect=false — the PR2
 *     burn hook) does NOT lifesteal. Pre-guarded here so PR2 can't regress it.
 *   - Carry-across-descent + reset-on-death live in descent.test (the carry suite).
 * Deterministic — fixed damage amounts; no RNG in the heal path.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import { buildTestRoom, roomCenter } from '../Room';
import { spawnEnemy, activeEnemyCount } from '../Enemy';
import { activeProjectileCount } from '../Projectile';
import { damageEnemy } from '../Combat';
import { LIFESTEAL_LEVELS, PLAYER_COMBAT, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;

/** A bare combat arena (mirrors combat.test): test room, player centred, pool
 *  cleared, encounter system disabled. */
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

/** Spawn one tanky enemy near the player and return it. */
function enemyAt(s: GameState, x: number, y: number) {
  spawnEnemy(s.enemies, x, y);
  const e = s.enemies.find((en) => en.active)!;
  e.health = 10_000; // never dies during these hits
  return e;
}

describe('Lifesteal — direct-hit heal (the damageEnemy hook)', () => {
  it('heals damage × frac on a direct hit (level I)', () => {
    const s = arena();
    s.player.lifestealLevel = 1; // frac 0.04
    s.player.health = 50;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 100, 1, 0, 0, s); // 100 dmg → heal 4
    expect(s.player.health).toBeCloseTo(50 + 100 * LIFESTEAL_LEVELS.frac[1], 6);
  });

  it('caps the heal per hit (maxPerHit) — bounds a big-amount / crit spike', () => {
    const s = arena();
    s.player.lifestealLevel = 3; // frac 0.10
    s.player.health = 50;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 1000, 1, 0, 0, s); // 0.10×1000 = 100, capped to maxPerHit
    expect(s.player.health).toBe(50 + LIFESTEAL_LEVELS.maxPerHit);
  });

  it('does NOT heal at full HP (no overheal litter)', () => {
    const s = arena();
    s.player.lifestealLevel = 3;
    s.player.health = PLAYER_COMBAT.maxHealth;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 100, 1, 0, 0, s);
    expect(s.player.health).toBe(PLAYER_COMBAT.maxHealth);
  });

  it('clamps the heal to max HP (never overshoots)', () => {
    const s = arena();
    s.player.lifestealLevel = 3;
    s.player.health = PLAYER_COMBAT.maxHealth - 2; // 2 below; a 12-cap heal would overshoot
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 1000, 1, 0, 0, s);
    expect(s.player.health).toBe(PLAYER_COMBAT.maxHealth);
  });

  it('level 0 = no heal (the axis is unowned)', () => {
    const s = arena();
    s.player.lifestealLevel = 0;
    s.player.health = 50;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 100, 1, 0, 0, s);
    expect(s.player.health).toBe(50);
  });

  it('BOUND: a DoT/TICK hit (isDirect=false) does NOT lifesteal — pre-guards PR2 burn', () => {
    const s = arena();
    s.player.lifestealLevel = 3; // max — would heal a lot if it fired
    s.player.health = 50;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 100, 1, 0, 0, s, false); // tick damage
    expect(s.player.health).toBe(50); // no heal from over-time damage
  });
});

describe('Lifesteal — auto-multiplies via the shared hook (pierce)', () => {
  it('a PIERCE shot through N enemies heals N times (one heal per damageEnemy call)', () => {
    const s = arena();
    s.player.lifestealLevel = 1; // frac 0.04
    s.player.health = 50;
    s.player.facingX = 1;
    s.player.facingY = 0;
    s.player.pierceLevel = 3; // infinite pass-through → hits both enemies
    enemyAt(s, s.player.x + 2, s.player.y);
    enemyAt(s, s.player.x + 4, s.player.y);
    expect(activeEnemyCount(s.enemies)).toBe(2);

    update(s, { ...createIntent(), ranged: true }, DT); // fire one shot
    let guard = 0;
    while (activeProjectileCount(s.projectiles) > 0 && guard < 1000) {
      update(s, createIntent(), DT);
      guard++;
    }
    // Two distinct enemies hit → two heals. Health climbed by 2× a single heal
    // (each heal = rangedDamage × frac, both well under maxPerHit + max HP).
    expect(s.player.health).toBeGreaterThan(50);
    // Exactly two applications: the gain is a positive multiple of one heal, and
    // strictly more than a single direct hit would give (proves the multiply).
    const oneHit = arena();
    oneHit.player.lifestealLevel = 1;
    oneHit.player.health = 50;
    oneHit.player.facingX = 1;
    oneHit.player.facingY = 0;
    oneHit.player.pierceLevel = 0; // first-hit-stops: exactly one enemy hit
    enemyAt(oneHit, oneHit.player.x + 2, oneHit.player.y);
    update(oneHit, { ...createIntent(), ranged: true }, DT);
    let g2 = 0;
    while (activeProjectileCount(oneHit.projectiles) > 0 && g2 < 1000) {
      update(oneHit, createIntent(), DT);
      g2++;
    }
    const single = oneHit.player.health - 50;
    expect(single).toBeGreaterThan(0); // sanity: the control actually healed once
    expect(s.player.health - 50).toBeCloseTo(single * 2, 4); // N=2 heals
  });
});
