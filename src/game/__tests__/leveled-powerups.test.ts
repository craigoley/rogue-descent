/**
 * Escalating powerups (Phase 9, PR1). Pins the four leveled axes + the level
 * model. LEVEL 0 = the no-powerup base for every axis (an un-upgraded run is
 * unchanged); picking up a kind increments its level, capped at POWERUP_MAX_LEVEL.
 *   - MELEE: damage scales (× over TUNING.meleeDamage).
 *   - RANGED: projectile COUNT (multishot spread).
 *   - PIERCE: pass-through COUNT (0=1 enemy, I=2, II=3, III=∞).
 *   - KNOCKBACK: shove force scales.
 * Persist across descent, reset on new run.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import { applyPickup } from '../Pickup';
import { meleeAttack } from '../Combat';
import { fireProjectile, updateProjectiles, activeProjectileCount } from '../Projectile';
import { spawnEnemy } from '../Enemy';
import {
  KNOCKBACK_LEVELS,
  MELEE_LEVELS,
  PIERCE_LEVELS,
  POWERUP_MAX_LEVEL,
  RANGED_LEVELS,
  SIM_DT,
  TUNING,
} from '../../utils/constants';

const DT = SIM_DT;

/** Fresh state, enemy pool emptied (tests own their spawns). */
function arena(): GameState {
  const s = createGameState();
  for (const e of s.enemies) e.active = false;
  for (const p of s.projectiles) p.active = false;
  return s;
}

describe('Level model — increment + cap', () => {
  it('picking up a kind increments its level; a 4th is a no-op at the cap', () => {
    const p = createPlayer(0, 0);
    expect(p.meleeLevel).toBe(0); // level 0 = un-upgraded
    applyPickup(p, 'melee');
    expect(p.meleeLevel).toBe(1);
    applyPickup(p, 'melee');
    expect(p.meleeLevel).toBe(2);
    applyPickup(p, 'melee');
    expect(p.meleeLevel).toBe(POWERUP_MAX_LEVEL); // 3
    applyPickup(p, 'melee');
    expect(p.meleeLevel).toBe(POWERUP_MAX_LEVEL); // capped — no overflow
  });

  it('each weapon kind levels its OWN field independently', () => {
    const p = createPlayer(0, 0);
    applyPickup(p, 'ranged');
    applyPickup(p, 'pierce');
    applyPickup(p, 'pierce');
    applyPickup(p, 'knockback');
    expect(p.meleeLevel).toBe(0);
    expect(p.rangedLevel).toBe(1);
    expect(p.pierceLevel).toBe(2);
    expect(p.knockbackLevel).toBe(1);
  });
});

describe('MELEE axis — damage scales, level 0 = base', () => {
  function meleeHit(level: number): number {
    const s = arena();
    s.player.meleeLevel = level;
    s.player.facingX = 1;
    s.player.facingY = 0;
    spawnEnemy(s.enemies, s.player.x + 1.0, s.player.y);
    const e = s.enemies.find((x) => x.active)!;
    const hp = e.health;
    meleeAttack(s, 1, 0);
    return hp - e.health;
  }

  it('level 0 deals the base TUNING.meleeDamage (un-upgraded unchanged)', () => {
    expect(meleeHit(0)).toBeCloseTo(TUNING.meleeDamage, 9);
  });

  it('higher levels deal more, per MELEE_LEVELS.damageMult', () => {
    expect(meleeHit(1)).toBeCloseTo(TUNING.meleeDamage * MELEE_LEVELS.damageMult[1], 9);
    expect(meleeHit(3)).toBeCloseTo(TUNING.meleeDamage * MELEE_LEVELS.damageMult[3], 9);
    expect(meleeHit(3)).toBeGreaterThan(meleeHit(0));
  });
});

describe('KNOCKBACK axis — force scales, level 0 = base shove', () => {
  function meleeShove(level: number): number {
    const s = arena();
    s.player.knockbackLevel = level;
    s.player.facingX = 1;
    s.player.facingY = 0;
    spawnEnemy(s.enemies, s.player.x + 1.0, s.player.y);
    const e = s.enemies.find((x) => x.active)!;
    meleeAttack(s, 1, 0);
    return e.kbVx; // shove along +x
  }

  it('level 0 = base MELEE.knockback; each level shoves harder', () => {
    expect(meleeShove(0)).toBeCloseTo(KNOCKBACK_LEVELS.force[0], 5);
    expect(meleeShove(1)).toBeCloseTo(KNOCKBACK_LEVELS.force[1], 5);
    expect(meleeShove(3)).toBeGreaterThan(meleeShove(1));
  });
});

describe('RANGED axis — multishot count, level 0 = 1 shot', () => {
  it('emits RANGED_LEVELS.shots[level] projectiles', () => {
    for (let level = 0; level <= POWERUP_MAX_LEVEL; level++) {
      const s = arena();
      fireProjectile(s.projectiles, 0, 0, 1, 0, level);
      expect(activeProjectileCount(s.projectiles)).toBe(RANGED_LEVELS.shots[level]);
    }
  });

  it('level 0 is a single straight shot (unchanged)', () => {
    const s = arena();
    fireProjectile(s.projectiles, 0, 0, 1, 0, 0);
    expect(activeProjectileCount(s.projectiles)).toBe(1);
    const shot = s.projectiles.find((p) => p.active)!;
    expect(shot.vy).toBeCloseTo(0, 9); // dead straight, no spread
  });
});

describe('PIERCE axis — pass-through COUNT', () => {
  /** Fire one bolt along +x through `n` enemies in a line at pierceLevel; return
   *  how many took damage before the bolt despawned. Uses an OPEN (wall-free) room
   *  so the bolt travels freely (the real floor would wall-stop it). */
  function pierceThrough(level: number, n: number): number {
    const s = arena();
    const W = 40;
    const H = 8;
    s.room = { tilesX: W, tilesY: H, tileSize: 1, walls: [], solid: new Array<boolean>(W * H).fill(false) };
    s.player.pierceLevel = level;
    const y = 4;
    for (let k = 0; k < n; k++) spawnEnemy(s.enemies, 2 + k * 1.5, y, 1, 'chaser', -1);
    const live = s.enemies.filter((e) => e.active);
    const hp0 = live.map((e) => e.health);
    // One bolt along the line; step it across all enemies (count is the RANGED axis).
    fireProjectile(s.projectiles, 0.5, y, 1, 0, 0);
    for (let i = 0; i < 120; i++) updateProjectiles(s, DT);
    return live.filter((e, i) => e.health < hp0[i]).length;
  }

  it('level 0 stops at the FIRST enemy (no pierce — unchanged)', () => {
    expect(pierceThrough(0, 4)).toBe(1);
  });

  it('level I hits 2, level II hits 3 (the pass-through count)', () => {
    expect(pierceThrough(1, 4)).toBe(PIERCE_LEVELS.maxHits[1]); // 2
    expect(pierceThrough(2, 4)).toBe(PIERCE_LEVELS.maxHits[2]); // 3
  });

  it('level III pierces an entire line (infinite pass-through)', () => {
    expect(pierceThrough(3, 4)).toBe(4); // all of them
  });
});
