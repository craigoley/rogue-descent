import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createPlayer, updatePlayer, isInvulnerable } from '../Player';
import { createIntent, type InputIntent } from '../Input';
import { buildTestRoom, roomCenter } from '../Room';
import { createEnemyPool, spawnEnemy } from '../Enemy';
import { activeProjectileCount } from '../Projectile';
import { activeParticleCount } from '../Particle';
import { damagePlayer } from '../Combat';
import {
  DASH,
  ENEMY,
  PLAYER_COMBAT,
  POOL,
  SIM_DT,
  TUNING,
} from '../../utils/constants';

const room = buildTestRoom();
const DT = SIM_DT;
// Screen-space (1,1) maps through the restored 45° iso yaw to a pure world +x
// dash (see Player's input rotation). That keeps the dash on the open centre row
// — a cardinal screen input would map to a world DIAGONAL that clips the corner
// pillars — so the distance/commitment assertions below read in plain world x.
const dashIntent = (): InputIntent => ({ ...createIntent(), moveX: 1, moveY: 1, dash: true });

/**
 * Combat tests run in the controlled, open TEST_ROOM arena — combat mechanics
 * shouldn't depend on a random generated floor. (Production createGameState now
 * builds a BSP dungeon; we override its room here and centre the player.)
 */
function arena(): GameState {
  const s = createGameState();
  s.room = buildTestRoom();
  const c = roomCenter(s.room);
  s.spawn = { x: c.x, y: c.y };
  s.player = createPlayer(c.x, c.y);
  for (const e of s.enemies) e.active = false;
  // Disable the Phase-5 encounter system in the combat arena — combat mechanics
  // are tested in isolation, not against the generated floor's rooms/gating.
  s.rooms = [];
  s.activeRoom = -1;
  return s;
}

describe('Dash', () => {
  it('bursts approximately dashDist in the committed direction', () => {
    const p = createPlayer(7, 7);
    const startX = p.x;
    updatePlayer(p, dashIntent(), DT, room); // trigger dash to +x
    let lastDashX = p.x;
    while (p.dashTimer > 0) {
      const before = p.dashTimer;
      updatePlayer(p, createIntent(), DT, room);
      if (before - DT > 0) lastDashX = p.x; // this step still dashed
    }
    const dist = lastDashX - startX;
    // dash speed = dashDist/duration; window length quantizes to whole steps, so
    // allow ~one step of slack either way.
    const slack = (TUNING.dashDist / DASH.duration) * DT * 1.5;
    expect(Math.abs(dist - TUNING.dashDist)).toBeLessThan(slack);
    expect(dist).toBeGreaterThan(3); // unmistakably a dash, not a normal step
  });

  it('is committed — move input mid-dash does not steer it', () => {
    const p = createPlayer(7, 7);
    updatePlayer(p, dashIntent(), DT, room); // dash +x
    // Try to steer down (+y) mid-dash; should keep going +x with ~no y drift.
    while (p.dashTimer > 0) updatePlayer(p, { ...createIntent(), moveY: 1 }, DT, room);
    expect(Math.abs(p.y - 7)).toBeLessThan(0.05);
    expect(p.x).toBeGreaterThan(9);
  });

  it('respects cooldown — a second dash during cooldown does nothing', () => {
    const p = createPlayer(7, 7);
    updatePlayer(p, dashIntent(), DT, room);
    while (p.dashTimer > 0) updatePlayer(p, createIntent(), DT, room);
    const xAfterFirst = p.x;
    expect(p.dashCdTimer).toBeGreaterThan(0);
    updatePlayer(p, dashIntent(), DT, room); // requested while on cooldown
    expect(p.dashTimer).toBe(0); // no new dash
    expect(p.x - xAfterFirst).toBeLessThan(0.5); // didn't burst again
  });
});

describe('Dash i-frames', () => {
  it('block damage during the window, then damage lands after it expires', () => {
    const s = arena();
    const p = s.player;
    updatePlayer(p, dashIntent(), DT, room);
    expect(isInvulnerable(p)).toBe(true);

    const hp = p.health;
    damagePlayer(p, 50, s);
    expect(p.health).toBe(hp); // blocked by i-frames

    // Let the dash + i-frames fully expire.
    const steps = Math.ceil(TUNING.dashIframes / DT) + 3;
    for (let i = 0; i < steps; i++) updatePlayer(p, createIntent(), DT, room);
    expect(isInvulnerable(p)).toBe(false);

    const hp2 = p.health;
    damagePlayer(p, 50, s);
    expect(p.health).toBe(hp2 - 50); // now it lands
  });
});

describe('Dash dodge feedback (visibility only — damage logic unchanged)', () => {
  it('a dash i-frame negates the hit AND registers a dodge (tell + whiff sparks)', () => {
    const s = arena();
    const p = s.player;
    const before = p.health;
    const partsBefore = activeParticleCount(s.particles);
    updatePlayer(p, dashIntent(), DT, room); // dash -> i-frames active
    expect(isInvulnerable(p)).toBe(true);

    damagePlayer(p, 50, s);
    expect(p.health).toBe(before); // damage still FULLY negated
    expect(p.dodgeFxTimer).toBeCloseTo(PLAYER_COMBAT.dodgeFx, 9); // dodge tell on
    expect(s.hitstopTimer).toBeGreaterThanOrEqual(PLAYER_COMBAT.dodgeHitstop); // time-dilation
    expect(activeParticleCount(s.particles)).toBeGreaterThan(partsBefore); // whiff burst
  });

  it('post-hit i-frames block silently — no dodge tell when not dashing', () => {
    const s = arena();
    const p = s.player;
    damagePlayer(p, 20, s); // first hit lands, grants post-hit i-frames
    const hp = p.health;
    expect(p.hitInvulnTimer).toBeGreaterThan(0);
    expect(p.iframeTimer).toBe(0); // not a dash

    damagePlayer(p, 20, s); // blocked by post-hit i-frames
    expect(p.health).toBe(hp); // no extra damage
    expect(p.dodgeFxTimer).toBe(0); // but NOT flagged as a dodge
  });
});

describe('Melee', () => {
  it('damages an enemy in range and inside the arc', () => {
    const s = arena();
    for (const e of s.enemies) e.active = false;
    s.player.facingX = 1;
    s.player.facingY = 0;
    spawnEnemy(s.enemies, s.player.x + 1.0, s.player.y); // in front, in range
    const e = s.enemies.find((x) => x.active)!;
    const hp = e.health;
    update(s, { ...createIntent(), melee: true }, DT);
    expect(e.health).toBe(hp - TUNING.meleeDamage);
  });

  it('misses an enemy behind the aim direction (outside the arc)', () => {
    const s = arena();
    for (const e of s.enemies) e.active = false;
    s.player.facingX = 1;
    s.player.facingY = 0;
    spawnEnemy(s.enemies, s.player.x - 1.0, s.player.y); // behind (-x)
    const e = s.enemies.find((x) => x.active)!;
    const hp = e.health;
    update(s, { ...createIntent(), melee: true }, DT);
    expect(e.health).toBe(hp); // not in the forward arc
  });

  it('misses an enemy out of range', () => {
    const s = arena();
    for (const e of s.enemies) e.active = false;
    s.player.facingX = 1;
    s.player.facingY = 0;
    spawnEnemy(s.enemies, s.player.x + 6, s.player.y); // far
    const e = s.enemies.find((x) => x.active)!;
    const hp = e.health;
    update(s, { ...createIntent(), melee: true }, DT);
    expect(e.health).toBe(hp);
  });
});

describe('Ranged', () => {
  it('spawns a projectile that travels, damages an enemy, and returns to the pool', () => {
    const s = arena();
    for (const e of s.enemies) e.active = false;
    s.player.facingX = 1;
    s.player.facingY = 0;
    spawnEnemy(s.enemies, s.player.x + 5, s.player.y);
    const e = s.enemies.find((x) => x.active)!;
    const hp = e.health;

    update(s, { ...createIntent(), ranged: true }, DT);
    expect(activeProjectileCount(s.projectiles)).toBe(1);

    let guard = 0;
    while (activeProjectileCount(s.projectiles) > 0 && guard < 1000) {
      update(s, createIntent(), DT);
      guard++;
    }
    expect(e.health).toBeLessThan(hp); // it connected
    expect(activeProjectileCount(s.projectiles)).toBe(0); // back in the pool
  });
});

describe('Enemy telegraph -> strike', () => {
  it('telegraphs on reaching range, then the strike damages the player', () => {
    const s = arena();
    for (const e of s.enemies) e.active = false;
    const p = s.player;
    spawnEnemy(s.enemies, p.x + ENEMY.attackRange * 0.5, p.y); // already in range
    const e = s.enemies.find((x) => x.active)!;
    const hp = p.health;

    update(s, createIntent(), DT);
    expect(e.phase).toBe('telegraph');
    expect(p.health).toBe(hp); // wind-up does not damage yet

    const steps = Math.ceil(ENEMY.telegraph / DT) + 3;
    for (let i = 0; i < steps; i++) update(s, createIntent(), DT);
    expect(p.health).toBeLessThan(hp); // the strike connected
  });

  it('dashing through the strike (i-frames) takes no damage', () => {
    const s = arena();
    for (const e of s.enemies) e.active = false;
    const p = s.player;
    spawnEnemy(s.enemies, p.x + ENEMY.attackRange * 0.5, p.y);
    const hp = p.health;

    // Advance most of the telegraph, then dash right as the strike lands.
    const nearStrike = Math.ceil(ENEMY.telegraph / DT) - 1;
    for (let i = 0; i < nearStrike; i++) update(s, createIntent(), DT);
    // Dash now; i-frames cover the strike window.
    for (let i = 0; i < 6; i++) update(s, { ...createIntent(), dash: i === 0 }, DT);
    expect(p.health).toBe(hp); // dodged through it
  });
});

describe('Death + reset', () => {
  it('player dies at zero health and the room auto-resets after the pause', () => {
    const s = arena();
    s.player.health = 5;
    s.player.iframeTimer = 0;
    s.player.hitInvulnTimer = 0;
    damagePlayer(s.player, 50, s);
    expect(s.player.health).toBeLessThanOrEqual(0);

    update(s, createIntent(), DT);
    expect(s.player.alive).toBe(false);
    expect(s.deathTimer).toBeGreaterThan(0);

    const steps = Math.ceil(PLAYER_COMBAT.deathPause / DT) + 3;
    for (let i = 0; i < steps; i++) update(s, createIntent(), DT);
    expect(s.player.alive).toBe(true); // reset
    expect(s.player.health).toBe(PLAYER_COMBAT.maxHealth);
  });
});

describe('Pools are fixed-size and reused (zero growth)', () => {
  it('sustained firing never grows the projectile/particle/enemy arrays', () => {
    const s = arena();
    const projLen = s.projectiles.length;
    const partLen = s.particles.length;
    const enemyLen = s.enemies.length;
    s.player.facingX = 1;
    s.player.facingY = 0;

    for (let i = 0; i < 400; i++) update(s, { ...createIntent(), ranged: true }, DT);

    expect(s.projectiles.length).toBe(projLen);
    expect(s.particles.length).toBe(partLen);
    expect(s.enemies.length).toBe(enemyLen);
    expect(activeProjectileCount(s.projectiles)).toBeLessThanOrEqual(POOL.projectiles);
    expect(activeParticleCount(s.particles)).toBeLessThanOrEqual(POOL.particles);
  });

  it('spawning enemies past capacity returns false and never grows the pool', () => {
    const pool = createEnemyPool();
    for (let i = 0; i < POOL.enemies; i++) expect(spawnEnemy(pool, 5, 5)).toBe(true);
    expect(spawnEnemy(pool, 5, 5)).toBe(false);
    expect(pool.length).toBe(POOL.enemies);
  });
});
