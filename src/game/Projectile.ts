/**
 * Pooled player projectiles (ranged attack). Pure: ZERO three/DOM. FIXED-SIZE
 * pool (POOL.projectiles) — firing reuses an inactive slot and never grows the
 * array, so a sustained stream of shots allocates nothing.
 *
 * Each step a projectile moves, ages out, despawns on a wall, or damages the
 * first enemy it overlaps (then despawns) via the shared Combat machinery.
 */

import { ENEMY_TYPES, PIERCE_LEVELS, POOL, RANGED, RANGED_LEVELS, TUNING } from '../utils/constants';
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
  /** Enemy-pool indices this shot has already hit — so a PIERCE shot damages
   *  each enemy at most once across the multiple frames it overlaps them. Owned
   *  per pooled slot (allocated once), cleared on fire; zero per-frame alloc. */
  hits: Set<number>;
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
    hits: new Set<number>(),
  }));
}

/** Activate one pooled projectile from (x, y) along the unit dir. Returns false if
 *  the pool is full (shot dropped — never grows the pool). */
function emitProjectile(pool: Projectile[], x: number, y: number, dirX: number, dirY: number): boolean {
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
    p.hits.clear();
    return true;
  }
  return false;
}

/** Fire a shot from (x, y) along the unit direction (dirX, dirY). Phase 9 RANGED
 *  level: emits RANGED_LEVELS.shots[level] projectiles in a fan of total
 *  RANGED_LEVELS.spreadAngle (level 0 = a single straight shot, unchanged).
 *  Returns true if at least one projectile fired (false only if the pool was
 *  full). Pool-full drops excess shots — never grows the pool. */
export function fireProjectile(
  pool: Projectile[],
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  level = 0,
): boolean {
  const shots = RANGED_LEVELS.shots[level];
  const spread = RANGED_LEVELS.spreadAngle;
  let fired = false;
  for (let s = 0; s < shots; s++) {
    // Centred fan: 1 shot -> straight; N shots -> evenly across [-spread/2, +spread/2].
    const a = shots === 1 ? 0 : -spread / 2 + (s * spread) / (shots - 1);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const ndx = dirX * cos - dirY * sin;
    const ndy = dirX * sin + dirY * cos;
    if (emitProjectile(pool, x, y, ndx, ndy)) fired = true;
  }
  return fired;
}

export function activeProjectileCount(pool: Projectile[]): number {
  let n = 0;
  for (const p of pool) if (p.active) n++;
  return n;
}

/** Advance every active projectile one fixed step. */
export function updateProjectiles(state: GameState, dt: number): void {
  const { projectiles, enemies, room } = state;
  // Phase 9 PIERCE level: a bolt damages up to maxHits DISTINCT enemies, then
  // despawns. Level 0 = 1 (first-hit-stops, the no-pierce default); I = 2, II = 3,
  // III = Infinity (the pre-Phase-9 infinite pass-through). p.hits already dedups
  // distinct enemies, so its size IS the pass-through count.
  const maxHits = PIERCE_LEVELS.maxHits[state.player.pierceLevel];
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
    // A wall stops EVERY shot, pierce or not.
    if (isSolid(room, Math.floor(p.x / room.tileSize), Math.floor(p.y / room.tileSize))) {
      p.active = false;
      continue;
    }
    // Enemy overlap: damage each DISTINCT enemy at most once (p.hits dedups), and
    // despawn once the bolt has hit maxHits enemies (level 0 -> after the first;
    // higher levels pass through more; III = Infinity, never stops on count).
    for (let ei = 0; ei < enemies.length; ei++) {
      const e = enemies[ei];
      if (!e.active) continue;
      const reach = RANGED.radius + ENEMY_TYPES[e.type].radius; // per-type hitbox
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (p.hits.has(ei)) continue; // already damaged this enemy
      const spd = Math.hypot(p.vx, p.vy) || 1;
      damageEnemy(e, TUNING.rangedDamage, p.vx / spd, p.vy / spd, RANGED.knockback, state);
      p.hits.add(ei);
      if (p.hits.size >= maxHits) {
        p.active = false;
        break;
      }
    }
  }
}
