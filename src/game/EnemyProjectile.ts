/**
 * Pooled RANGED-ENEMY bolts (Phase 7.5). Pure: ZERO three/DOM. FIXED-SIZE pool
 * (POOL.enemyProjectiles); firing reuses an inactive slot and never grows it.
 *
 * Deliberately SEPARATE from the player's Projectile system: this one targets
 * the PLAYER (via the shared damagePlayer, so dash i-frames negate it for free),
 * is slower (dodgeable), has no pierce/hit-set, and carries its own per-bolt
 * damage. The player projectile system stays untouched (pierce remains
 * player-only, no team flag).
 *
 * Each step a bolt moves, ages out, despawns on a wall, or hits the player
 * (then despawns).
 */

import { ENEMY_PROJ, PLAYER, POOL } from '../utils/constants';
import { isSolid } from './Room';
import { damagePlayer } from './Combat';
import type { GameState } from './GameState';

export interface EnemyProjectile {
  active: boolean;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  /** Remaining life, seconds. */
  life: number;
  /** Damage applied to the player on hit (depth-scaled at fire time). */
  damage: number;
}

export function createEnemyProjectilePool(): EnemyProjectile[] {
  return Array.from({ length: POOL.enemyProjectiles }, () => ({
    active: false,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    life: 0,
    damage: 0,
  }));
}

/** Fire a bolt from (x, y) along unit direction (dirX, dirY), carrying `damage`.
 *  Returns false if the pool is full (shot dropped — never grows the pool). */
export function fireEnemyProjectile(
  pool: EnemyProjectile[],
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  damage: number,
): boolean {
  for (const p of pool) {
    if (p.active) continue;
    p.active = true;
    p.x = x;
    p.y = y;
    p.prevX = x;
    p.prevY = y;
    p.vx = dirX * ENEMY_PROJ.speed;
    p.vy = dirY * ENEMY_PROJ.speed;
    p.life = ENEMY_PROJ.lifetime;
    p.damage = damage;
    return true;
  }
  return false;
}

export function activeEnemyProjectileCount(pool: EnemyProjectile[]): number {
  let n = 0;
  for (const p of pool) if (p.active) n++;
  return n;
}

/** Advance every active enemy bolt one fixed step. Hits the player through
 *  damagePlayer (dash i-frames negate it); walls stop it. */
export function updateEnemyProjectiles(state: GameState, dt: number): void {
  const { enemyProjectiles, player, room } = state;
  const reach = ENEMY_PROJ.radius + PLAYER.radius;
  const r2 = reach * reach;
  for (const p of enemyProjectiles) {
    if (!p.active) continue;
    p.prevX = p.x;
    p.prevY = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }
    // Wall hit (point test — bolt radius is small relative to a tile).
    if (isSolid(room, Math.floor(p.x / room.tileSize), Math.floor(p.y / room.tileSize))) {
      p.active = false;
      continue;
    }
    // Player overlap: damage (i-frame gate lives in damagePlayer) + despawn. A
    // dead player can't be hit (death ends the run / freezes the sim).
    if (player.alive) {
      const dx = player.x - p.x;
      const dy = player.y - p.y;
      if (dx * dx + dy * dy <= r2) {
        damagePlayer(player, p.damage, state);
        p.active = false;
      }
    }
  }
}
