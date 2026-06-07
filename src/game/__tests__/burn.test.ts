/**
 * SYNERGY ARC — PR2 BURN (damage-over-time). Pins the contract:
 *   - A DIRECT hit at burnLevel>=1 IGNITES (sets burnTimer + burnDps); level 0 = none.
 *   - The tick deals continuous dps×dt damage and EXPIRES after BURN_LEVELS.duration.
 *   - The tick routes through damageEnemy(isDirect=FALSE), so it does NOT lifesteal
 *     (the #66 guard holds) and never re-ignites itself.
 *   - It hooks the shared choke point, so pierce → ignites N enemies (auto-multiply).
 *   - REFRESH-not-stack: re-igniting resets duration, leaves dps at the level rate.
 *   - ⭐ THE NEW PATH: a burn-TICK kill (the first non-direct kill source) is observed
 *     by the SAME gating — run.kills increments, a drop rolls, roomEnemyCount clears —
 *     because GameState's death diff + encounter resolve run AFTER updateEnemies.
 *   - burnTimer resets on spawn/recycle.
 * Deterministic — continuous dps×dt at fixed SIM_DT, no RNG in the burn path.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import { buildTestRoom, roomCenter } from '../Room';
import { spawnEnemy, roomEnemyCount } from '../Enemy';
import { activeProjectileCount } from '../Projectile';
import { activePickupCount } from '../Pickup';
import { damageEnemy } from '../Combat';
import { createBossState } from '../Boss';
import { BURN_LEVELS, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;

/** Bare combat arena (mirrors lifesteal.test): test room, player centred, pool
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

function enemyAt(s: GameState, x: number, y: number) {
  spawnEnemy(s.enemies, x, y);
  const e = s.enemies.find((en) => en.active)!;
  e.health = 10_000; // survives the apply tests (burn alone won't kill in the window)
  return e;
}

describe('Burn — apply on a direct hit', () => {
  it('a direct hit at burnLevel>=1 ignites (sets burnTimer + burnDps)', () => {
    const s = arena();
    s.player.burnLevel = 2;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s); // direct hit
    expect(e.burnTimer).toBe(BURN_LEVELS.duration);
    expect(e.burnDps).toBe(BURN_LEVELS.dps[2]);
  });

  it('level 0 = no ignition', () => {
    const s = arena();
    s.player.burnLevel = 0;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s);
    expect(e.burnTimer).toBe(0);
  });

  it('a TICK (isDirect=false) does NOT re-ignite itself (no infinite refresh)', () => {
    const s = arena();
    s.player.burnLevel = 3;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    e.burnTimer = 0.1; // mid-burn, about to expire
    damageEnemy(e, 5, 0, 0, 0, s, false); // the tick path
    expect(e.burnTimer).toBe(0.1); // unchanged — the tick didn't refresh it
  });
});

describe('Burn — tick (DoT over time)', () => {
  it('ticks dps×dt damage each step and expires after the duration', () => {
    const s = arena();
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    e.health = 100;
    e.burnTimer = BURN_LEVELS.duration;
    e.burnDps = BURN_LEVELS.dps[3]; // 12 dps
    const steps = Math.ceil(BURN_LEVELS.duration / DT) + 5;
    for (let i = 0; i < steps; i++) update(s, createIntent(), DT);
    // Total burn ≈ dps × duration; expired (timer back to 0, no further damage).
    expect(e.burnTimer).toBe(0);
    expect(e.health).toBeCloseTo(100 - BURN_LEVELS.dps[3] * BURN_LEVELS.duration, 1);
  });

  it('a burn tick on the boss bypasses the armor check and deals damage', () => {
    const s = createGameState();
    for (const en of s.enemies) en.active = false;
    spawnEnemy(s.enemies, 20, 20, 1, 'boss', s.bossRoom);
    const slot = s.enemies.findIndex((en) => en.active && en.type === 'boss');
    s.boss = createBossState(slot, 1);
    const e = s.enemies[slot];
    const hp0 = e.health;
    e.burnTimer = BURN_LEVELS.duration;
    e.burnDps = BURN_LEVELS.dps[3];
    for (let i = 0; i < 30; i++) update(s, createIntent(), DT);
    expect(e.health).toBeLessThan(hp0);
  });

  it('a burn tick does NOT lifesteal (the #66 isDirect guard holds)', () => {
    const s = arena();
    s.player.lifestealLevel = 3; // would heal a lot if a tick counted
    s.player.health = 50;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    e.burnTimer = BURN_LEVELS.duration;
    e.burnDps = BURN_LEVELS.dps[3];
    for (let i = 0; i < 30; i++) update(s, createIntent(), DT);
    expect(s.player.health).toBe(50); // burn ticks never heal
  });
});

describe('Burn — refresh-not-stack', () => {
  it('re-igniting resets duration and leaves dps at the level rate (no stack)', () => {
    const s = arena();
    s.player.burnLevel = 1; // dps[1]
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s);
    e.burnTimer = 0.5; // let it burn down a bit
    damageEnemy(e, 10, 1, 0, 0, s); // re-ignite
    expect(e.burnTimer).toBe(BURN_LEVELS.duration); // duration RESET (not extended past)
    expect(e.burnDps).toBe(BURN_LEVELS.dps[1]); // dps unchanged — NOT 2×
  });
});

describe('Burn — multiplies via the shared hook (pierce ignites the line)', () => {
  it('a pierce shot ignites every enemy it passes through', () => {
    const s = arena();
    s.player.burnLevel = 2;
    s.player.facingX = 1;
    s.player.facingY = 0;
    s.player.pierceLevel = 3; // infinite pass-through
    const e1 = enemyAt(s, s.player.x + 2, s.player.y);
    const e2 = enemyAt(s, s.player.x + 4, s.player.y);
    update(s, { ...createIntent(), ranged: true }, DT); // one shot
    let guard = 0;
    while (activeProjectileCount(s.projectiles) > 0 && guard < 1000) {
      update(s, createIntent(), DT);
      guard++;
    }
    expect(e1.burnTimer).toBeGreaterThan(0); // both lit by the single piercing shot
    expect(e2.burnTimer).toBeGreaterThan(0);
  });
});

describe('Burn — the tick-kill path (first non-direct kill source)', () => {
  it('a burn-tick kill counts as a kill, rolls a drop, and clears the room', () => {
    const s = createGameState(); // real dungeon (encounter system live)
    for (const e of s.enemies) e.active = false;
    const ri = 1; // a non-spawn encounter room
    const r = s.rooms[ri].rect;
    const ts = s.room.tileSize;
    const ex = (r.x + r.w / 2) * ts;
    const ey = (r.y + r.h / 2) * ts;
    s.rooms[ri].phase = 'active';
    s.activeRoom = ri;
    spawnEnemy(s.enemies, ex, ey, 1, 'chaser', ri);
    const e = s.enemies.find((en) => en.active && en.roomIndex === ri)!;
    e.health = 3; // dies within a few burn ticks
    e.burnTimer = BURN_LEVELS.duration;
    e.burnDps = BURN_LEVELS.dps[3]; // 12 dps → dead in ~0.25s

    // Force a guaranteed drop: hurt player + a dropRng that yields a HEALTH drop
    // ([chance<0.3 → drop], [health<0.6 → health]); player hurt so it isn't suppressed.
    s.player.health = 10;
    s.dropRng = { next: () => 0, int: () => 0 };

    const kills0 = s.run.kills;
    const picks0 = activePickupCount(s.pickups);
    let guard = 0;
    while (e.active && guard < 120) {
      update(s, createIntent(), DT);
      guard++;
    }
    expect(e.active).toBe(false); // burned to death
    expect(s.run.kills).toBe(kills0 + 1); // the death diff observed the TICK kill
    expect(activePickupCount(s.pickups)).toBe(picks0 + 1); // ...and rolled+spawned a drop
    expect(roomEnemyCount(s.enemies, ri)).toBe(0); // ...and the room sees it cleared
  });
});

describe('Burn — reset on spawn', () => {
  it('a recycled pool slot never inherits a burn', () => {
    const s = arena();
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    e.burnTimer = 5;
    e.burnDps = 99;
    e.active = false; // free the slot
    spawnEnemy(s.enemies, s.player.x + 3, s.player.y); // recycle it
    const recycled = s.enemies.find((en) => en.active)!;
    expect(recycled.burnTimer).toBe(0);
    expect(recycled.burnDps).toBe(0);
  });
});
