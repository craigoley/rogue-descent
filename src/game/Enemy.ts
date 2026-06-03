/**
 * The ONE enemy type (Phase 2) and its pooled AI. Pure: ZERO three/DOM.
 * FIXED-SIZE pool (POOL.enemies); spawning never grows it.
 *
 * Behaviour: chase the player; on reaching attackRange, TELEGRAPH (stand still
 * and wind up — the dodge window that makes the dash matter) then STRIKE (one
 * damage check) then RECOVER (a pause) then chase again. Movement collides with
 * walls (same tilemap as the player) so visuals and collision stay in sync.
 */

import { ENEMY, POOL } from '../utils/constants';
import { resolveX, resolveY } from './Collision';
import { damagePlayer } from './Combat';
import { damageMultForDepth, healthMultForDepth, speedMultForDepth } from './Difficulty';
import type { GameState } from './GameState';

export type EnemyPhase = 'chase' | 'telegraph' | 'strike' | 'recover';

export interface Enemy {
  active: boolean;
  x: number;
  y: number;
  /** Previous sim-step position (render interpolation). */
  prevX: number;
  prevY: number;
  health: number;
  /** Move speed (world units/sec) — scaled by depth at spawn (Phase 7c). */
  moveSpeed: number;
  /** Strike damage — scaled by depth at spawn (Phase 7c). */
  attackDamage: number;
  phase: EnemyPhase;
  /** Countdown within the current phase, seconds. */
  timer: number;
  /** Hit-flash countdown, seconds. */
  flashTimer: number;
  /** Knockback velocity (decays), world units/sec. */
  kbVx: number;
  kbVy: number;
  /** Whether this strike has already resolved its single damage check. */
  struck: boolean;
}

export function createEnemyPool(): Enemy[] {
  return Array.from({ length: POOL.enemies }, () => ({
    active: false,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    health: 0,
    moveSpeed: ENEMY.moveSpeed,
    attackDamage: ENEMY.attackDamage,
    phase: 'chase' as EnemyPhase,
    timer: 0,
    flashTimer: 0,
    kbVx: 0,
    kbVy: 0,
    struck: false,
  }));
}

/**
 * Activate a pooled enemy at (x, y), with stats scaled for `depth` (Phase 7c;
 * depth defaults to 1 = baseline). ENEMY.* is const, so the scaled values are
 * computed here and stored per-enemy (the AI reads e.moveSpeed / e.attackDamage).
 * No-op (returns false) if the pool is full.
 */
export function spawnEnemy(pool: Enemy[], x: number, y: number, depth = 1): boolean {
  for (const e of pool) {
    if (e.active) continue;
    e.active = true;
    e.x = x;
    e.y = y;
    e.prevX = x;
    e.prevY = y;
    e.health = ENEMY.maxHealth * healthMultForDepth(depth);
    e.moveSpeed = ENEMY.moveSpeed * speedMultForDepth(depth);
    e.attackDamage = ENEMY.attackDamage * damageMultForDepth(depth);
    e.phase = 'chase';
    e.timer = 0;
    e.flashTimer = 0;
    e.kbVx = 0;
    e.kbVy = 0;
    e.struck = false;
    return true;
  }
  return false;
}

export function activeEnemyCount(pool: Enemy[]): number {
  let n = 0;
  for (const e of pool) if (e.active) n++;
  return n;
}

/** Advance every active enemy one fixed step against the shared game state. */
export function updateEnemies(state: GameState, dt: number): void {
  const { player, room, enemies } = state;
  const kbDecay = Math.pow(ENEMY.knockbackDecay, dt);

  for (const e of enemies) {
    if (!e.active) continue;
    e.prevX = e.x;
    e.prevY = e.y;
    if (e.flashTimer > 0) e.flashTimer = Math.max(0, e.flashTimer - dt);

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy);

    let desiredVx = 0;
    let desiredVy = 0;

    switch (e.phase) {
      case 'chase':
        if (player.alive && d <= ENEMY.attackRange) {
          e.phase = 'telegraph';
          e.timer = ENEMY.telegraph;
        } else if (player.alive && d > 0) {
          desiredVx = (dx / d) * e.moveSpeed; // depth-scaled at spawn
          desiredVy = (dy / d) * e.moveSpeed;
        }
        break;
      case 'telegraph':
        e.timer -= dt;
        if (e.timer <= 0) {
          e.phase = 'strike';
          e.timer = ENEMY.strike;
          e.struck = false;
        }
        break;
      case 'strike':
        if (!e.struck) {
          e.struck = true;
          if (player.alive && d <= ENEMY.attackReach) {
            damagePlayer(player, e.attackDamage, state); // depth-scaled at spawn
          }
        }
        e.timer -= dt;
        if (e.timer <= 0) {
          e.phase = 'recover';
          e.timer = ENEMY.recover;
        }
        break;
      case 'recover':
        e.timer -= dt;
        if (e.timer <= 0) e.phase = 'chase';
        break;
    }

    // Integrate desired movement + decaying knockback, one axis at a time so
    // enemies stop/slide on walls exactly like the player.
    e.kbVx *= kbDecay;
    e.kbVy *= kbDecay;
    const moveX = (desiredVx + e.kbVx) * dt;
    e.x = resolveX(e.x, e.y, moveX, ENEMY.radius, room);
    const moveY = (desiredVy + e.kbVy) * dt;
    e.y = resolveY(e.x, e.y, moveY, ENEMY.radius, room);
  }
}
