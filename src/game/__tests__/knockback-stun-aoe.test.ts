/**
 * Knockback STUN (level II) + AoE (level III) — Phase 9 PR2. Pins:
 *   - Stun is set on a melee knockback hit at level >= 2 (NOT at I), NOT on the
 *     boss, NOT by projectiles/dash-strike (melee-only).
 *   - A stunned enemy FREEZES its AI (no desired movement, phase held) but its
 *     knockback STILL integrates (it's shoved); stun decrements + expires.
 *   - AoE (level III) shoves + stuns out-of-arc, in-range enemies with NO damage;
 *     level II is arc-only; in-arc enemies take damage at every level.
 *   - The boss takes force on a melee hit but is never stunned.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { meleeAttack, applyKnockback, damageEnemy } from '../Combat';
import { updateEnemies, spawnEnemy } from '../Enemy';
import { createBossState } from '../Boss';
import { fireProjectile, updateProjectiles } from '../Projectile';
import { KNOCKBACK_LEVELS, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;

/** Fresh state, pools emptied, in an OPEN (wall-free) room so knockback can move
 *  enemies freely (the real floor would clamp/wall them). Player at (10, 10). */
function arena(): GameState {
  const s = createGameState();
  for (const e of s.enemies) e.active = false;
  for (const p of s.projectiles) p.active = false;
  const W = 40;
  const H = 40;
  s.room = { tilesX: W, tilesY: H, tileSize: 1, walls: [], solid: new Array<boolean>(W * H).fill(false) };
  s.activeRoom = -1; // no room-rect clamp in the tail
  s.player.x = 10;
  s.player.y = 10;
  s.player.facingX = 1;
  s.player.facingY = 0;
  return s;
}

/** Spawn one enemy in front of the player (+x, in melee arc + reach). */
function frontEnemy(s: GameState, type: GameState['enemies'][number]['type'] = 'chaser') {
  spawnEnemy(s.enemies, s.player.x + 1.0, s.player.y, 1, type, -1);
  return s.enemies.find((e) => e.active && e.type === type)!;
}

describe('Stun — set conditions (melee, level >= 2, not boss)', () => {
  it('level I does NOT stun (force only)', () => {
    const s = arena();
    s.player.knockbackLevel = 1;
    const e = frontEnemy(s);
    meleeAttack(s, 1, 0);
    expect(e.stunTimer).toBe(0);
  });

  it('level II stuns the hit enemy', () => {
    const s = arena();
    s.player.knockbackLevel = 2;
    const e = frontEnemy(s);
    meleeAttack(s, 1, 0);
    expect(e.stunTimer).toBeCloseTo(KNOCKBACK_LEVELS.stunDuration, 9);
  });

  it('a projectile hit does NOT stun (stun is melee-only)', () => {
    const s = arena();
    s.player.knockbackLevel = 3; // even at max, ranged never stuns
    const e = frontEnemy(s);
    // Fire a bolt into the enemy and step it onto them.
    fireProjectile(s.projectiles, s.player.x, s.player.y, 1, 0, 0);
    for (let i = 0; i < 20 && e.stunTimer === 0 && e.active; i++) updateProjectiles(s, DT);
    expect(e.stunTimer).toBe(0);
  });

  it('a direct damageEnemy call does NOT stun (dash-strike path)', () => {
    const s = arena();
    const e = frontEnemy(s);
    damageEnemy(e, 5, 1, 0, KNOCKBACK_LEVELS.force[3], s);
    expect(e.stunTimer).toBe(0);
  });
});

describe('Stun — freezes AI but knockback still integrates', () => {
  it('a stunned chaser does NOT chase (frozen) yet is still shoved by knockback', () => {
    const s = arena();
    s.player.knockbackLevel = 2;
    const e = frontEnemy(s);
    meleeAttack(s, 1, 0); // damages + shoves (+x) + stuns
    expect(e.stunTimer).toBeGreaterThan(0);
    const x0 = e.x;
    // Move the player FAR away so a non-stunned chaser would chase toward it (-x).
    s.player.x = 0;
    s.player.y = 10;
    updateEnemies(s, DT);
    // Still stunned -> it did NOT move toward the player (no chase); the residual
    // knockback pushed it further +x (away from the now-left player).
    expect(e.x).toBeGreaterThan(x0); // shoved, not chasing back toward the player
    expect(e.stunTimer).toBeLessThan(KNOCKBACK_LEVELS.stunDuration); // decremented
  });

  it('stun expires after stunDuration, then the enemy chases again', () => {
    const s = arena();
    s.player.knockbackLevel = 2;
    const e = frontEnemy(s);
    e.kbVx = 0; // isolate AI movement from knockback
    e.kbVy = 0;
    e.stunTimer = KNOCKBACK_LEVELS.stunDuration;
    const steps = Math.ceil(KNOCKBACK_LEVELS.stunDuration / DT) + 1;
    for (let i = 0; i < steps; i++) updateEnemies(s, DT);
    expect(e.stunTimer).toBe(0);
    // Now un-stunned: with the player to the -x, one more step chases left.
    s.player.x = 0;
    const x1 = e.x;
    updateEnemies(s, DT);
    expect(e.x).toBeLessThan(x1); // chasing toward the player again
  });
});

describe('Boss — force applies, never stunned', () => {
  it('a melee knockback hit on the boss shoves it but sets no stun', () => {
    const s = arena();
    s.player.knockbackLevel = 3;
    spawnEnemy(s.enemies, s.player.x + 1.0, s.player.y, 1, 'boss', s.bossRoom);
    const boss = s.enemies.find((e) => e.active && e.type === 'boss')!;
    s.boss = createBossState(s.enemies.indexOf(boss), 1);
    s.boss.vulnerableAngle = Math.PI; // weak side faces the player (-x) so the hit lands
    meleeAttack(s, 1, 0);
    expect(boss.stunTimer).toBe(0); // STUN-IMMUNE
    expect(Math.abs(boss.kbVx) + Math.abs(boss.kbVy)).toBeGreaterThan(0); // force still applied
  });
});

describe('AoE — level III shove+stun out-of-arc, no damage; II is arc-only', () => {
  /** An enemy BEHIND the player (-x), within aoeRadius but outside the +x arc. */
  function behindInRange(s: GameState) {
    spawnEnemy(s.enemies, s.player.x - 1.2, s.player.y, 1, 'chaser', -1);
    return s.enemies.find((e) => e.active)!;
  }

  it('level II does NOT touch an out-of-arc enemy (arc-only)', () => {
    const s = arena();
    s.player.knockbackLevel = 2;
    const e = behindInRange(s);
    const hp = e.health;
    meleeAttack(s, 1, 0); // aim +x; enemy is at -x (behind)
    expect(e.health).toBe(hp); // no damage
    expect(e.stunTimer).toBe(0); // no stun
    expect(e.kbVx).toBe(0); // no shove
  });

  it('level III shoves + stuns the out-of-arc enemy with NO damage', () => {
    const s = arena();
    s.player.knockbackLevel = 3;
    const e = behindInRange(s);
    const hp = e.health;
    meleeAttack(s, 1, 0);
    expect(e.health).toBe(hp); // AoE deals NO damage (crowd-control)
    expect(e.stunTimer).toBeCloseTo(KNOCKBACK_LEVELS.stunDuration, 9); // stunned
    expect(Math.abs(e.kbVx) + Math.abs(e.kbVy)).toBeGreaterThan(0); // shoved
  });

  it('in-arc enemy still takes damage at level III (arc damage unchanged)', () => {
    const s = arena();
    s.player.knockbackLevel = 3;
    const e = frontEnemy(s); // +x, in arc
    const hp = e.health;
    meleeAttack(s, 1, 0);
    expect(e.health).toBeLessThan(hp); // arc damage still lands
    expect(e.stunTimer).toBeGreaterThan(0);
  });

  it('an enemy beyond aoeRadius is untouched even at level III', () => {
    const s = arena();
    s.player.knockbackLevel = 3;
    spawnEnemy(s.enemies, s.player.x - (KNOCKBACK_LEVELS.aoeRadius + 2), s.player.y, 1, 'chaser', -1);
    const e = s.enemies.find((en) => en.active)!;
    const hp = e.health;
    meleeAttack(s, 1, 0);
    expect(e.health).toBe(hp);
    expect(e.stunTimer).toBe(0);
    expect(e.kbVx).toBe(0);
  });
});

describe('applyKnockback helper — impulse only', () => {
  it('adds a knockback impulse without touching health', () => {
    const s = arena();
    const e = frontEnemy(s);
    const hp = e.health;
    applyKnockback(e, 1, 0, KNOCKBACK_LEVELS.force[2]);
    expect(e.health).toBe(hp); // no damage
    expect(e.kbVx).toBeGreaterThan(0); // impulse applied
  });
});
