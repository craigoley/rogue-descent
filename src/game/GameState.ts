/**
 * The pure game-state container and its single `update` entry point. Owns the
 * player, the room, and the three FIXED-SIZE pools (projectiles, enemies,
 * particles). Imports NOTHING from three and never touches the DOM, so the whole
 * simulation runs and is unit-tested in Node. The rendering layer READS a
 * GameState; it must never mutate one.
 *
 * `update` is the only mutation path and the per-step order of operations:
 *   death/reset -> hit-stop freeze -> player -> attacks -> projectiles ->
 *   enemies -> particles -> shake decay -> death trigger.
 */

import {
  MELEE,
  PARTICLE,
  PLAYER_COMBAT,
  RANGED,
  SHAKE,
  ENEMY_SPAWNS,
} from '../utils/constants';
import { createPlayer, updatePlayer, type PlayerState } from './Player';
import { buildTestRoom, roomCenter, type RoomState } from './Room';
import {
  createEnemyPool,
  spawnEnemy,
  updateEnemies,
  type Enemy,
} from './Enemy';
import {
  createProjectilePool,
  fireProjectile,
  updateProjectiles,
  type Projectile,
} from './Projectile';
import {
  createParticlePool,
  spawnParticles,
  updateParticles,
  type Particle,
} from './Particle';
import { aimDirection, meleeAttack } from './Combat';
import type { InputIntent } from './Input';
import type { Vec2 } from '../utils/math';

export interface GameState {
  player: PlayerState;
  room: RoomState;
  /** Seconds elapsed in the current life. */
  time: number;
  projectiles: Projectile[];
  enemies: Enemy[];
  particles: Particle[];
  /** Global freeze-frame on impact, seconds. While > 0 the sim is paused. */
  hitstopTimer: number;
  /** Screen-shake countdown, seconds (renderer reads it). */
  shakeTimer: number;
  /** Dead time remaining before the room auto-resets, seconds. */
  deathTimer: number;
}

/** Reused aim scratch — keeps `update` allocation-free. */
const _aim: Vec2 = { x: 0, y: 0 };

function spawnRoomEnemies(state: GameState): void {
  for (const s of ENEMY_SPAWNS) spawnEnemy(state.enemies, s.x, s.y);
}

export function createGameState(): GameState {
  const room = buildTestRoom();
  const c = roomCenter(room);
  const state: GameState = {
    player: createPlayer(c.x, c.y),
    room,
    time: 0,
    projectiles: createProjectilePool(),
    enemies: createEnemyPool(),
    particles: createParticlePool(),
    hitstopTimer: 0,
    shakeTimer: 0,
    deathTimer: 0,
  };
  spawnRoomEnemies(state);
  return state;
}

/** Reset for a fresh attempt (Phase 4 adds real run structure; this just lets
 *  you keep playing). Pools are REUSED — deactivated, not reallocated. */
export function resetRun(state: GameState): void {
  const c = roomCenter(state.room);
  state.player = createPlayer(c.x, c.y);
  for (const e of state.enemies) e.active = false;
  for (const p of state.projectiles) p.active = false;
  for (const p of state.particles) p.active = false;
  state.hitstopTimer = 0;
  state.shakeTimer = 0;
  state.deathTimer = 0;
  state.time = 0;
  spawnRoomEnemies(state);
}

export function update(state: GameState, intent: InputIntent, dt: number): void {
  const p = state.player;

  // Dead: freeze the sim, count down, then reset the room.
  if (!p.alive) {
    state.deathTimer -= dt;
    if (state.deathTimer <= 0) resetRun(state);
    return;
  }

  // Hit-stop: pause the entire sim for a few ms to sell the impact.
  if (state.hitstopTimer > 0) {
    state.hitstopTimer -= dt;
    return;
  }

  state.time += dt;

  updatePlayer(p, intent, dt, state.room);

  // Melee — edge-triggered, consumed here.
  if (intent.melee) {
    intent.melee = false;
    if (p.meleeCdTimer <= 0) {
      const aim = aimDirection(p, intent, _aim);
      meleeAttack(state, aim.x, aim.y);
      p.meleeCdTimer = MELEE.cooldown;
      p.meleeAnimTimer = MELEE.active;
    }
  }

  // Ranged — held; fires at the weapon cooldown.
  if (intent.ranged && p.rangedCdTimer <= 0) {
    const aim = aimDirection(p, intent, _aim);
    fireProjectile(state.projectiles, p.x, p.y, aim.x, aim.y);
    p.rangedCdTimer = RANGED.cooldown;
  }

  updateProjectiles(state, dt);
  updateEnemies(state, dt);
  updateParticles(state.particles, dt);

  if (state.shakeTimer > 0) state.shakeTimer -= dt;

  // Death trigger.
  if (p.health <= 0) {
    p.alive = false;
    p.health = 0;
    state.deathTimer = PLAYER_COMBAT.deathPause;
    spawnParticles(state.particles, p.x, p.y, PARTICLE.deathCount);
    state.shakeTimer = SHAKE.duration;
  }
}
