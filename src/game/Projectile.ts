/**
 * Pooled player projectiles (ranged attack). Pure: ZERO three/DOM. FIXED-SIZE
 * pool (POOL.projectiles) — firing reuses an inactive slot and never grows the
 * array, so a sustained stream of shots allocates nothing.
 *
 * Each step a projectile moves, ages out, despawns on a wall, or damages the
 * first enemy it overlaps (then despawns) via the shared Combat machinery.
 */

import { ENEMY, POOL, RANGED, TUNING } from '../utils/constants';
import { isSolid } from './Room';
import { damageEnemy } from './Combat';
import type { GameState } from './GameState';

export interface Projectile {
  active: boolean;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  /** Remaining life, seconds. */
  life: number;
}

export function createProjectilePool(): Projectile[] {
  return Array.from({ length: POOL.projectiles }, () => ({
    active: false,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    vx: 0,
    vy: 0,
    life: 0,
  }));
}

/** Fire a projectile from (x, y) along the unit direction (dirX, dirY). Returns
 *  false if the pool is full (shot dropped — never grows the pool). */
export function fireProjectile(
  pool: Projectile[],
  x: number,
  y: number,
  dirX: number,
  dirY: number,
): boolean {
  for (const p of pool) {
    if (p.active) continue;
    p.active = true;
    p.x = x;
    p.y = y;
    p.prevX = x;
    p.prevY = y;
    p.vx = dirX * RANGED.speed;
    p.vy = dirY * RANGED.speed;
    p.life = RANGED.lifetime;
    return true;
  }
  return false;
}

export function activeProjectileCount(pool: Projectile[]): number {
  let n = 0;
  for (const p of pool) if (p.active) n++;
  return n;
}

/** Advance every active projectile one fixed step. */
export function updateProjectiles(state: GameState, dt: number): void {
  const { projectiles, enemies, room } = state;
  const reach = RANGED.radius + ENEMY.radius;
  for (const p of projectiles) {
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
    // Wall hit (point test — projectile radius is small relative to a tile).
    if (isSolid(room, Math.floor(p.x / room.tileSize), Math.floor(p.y / room.tileSize))) {
      p.active = false;
      continue;
    }
    // First enemy overlap takes the hit and stops the projectile.
    for (const e of enemies) {
      if (!e.active) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy <= reach * reach) {
        const spd = Math.hypot(p.vx, p.vy) || 1;
        damageEnemy(e, TUNING.rangedDamage, p.vx / spd, p.vy / spd, RANGED.knockback, state);
        p.active = false;
        break;
      }
    }
  }
}
