/**
 * Enemy roster + pooled AI (Phase 7.5 type system). Pure: ZERO three/DOM.
 * FIXED-SIZE pool (POOL.enemies); spawning never grows it. A single pool holds a
 * MIX of types — each enemy carries a `type` discriminant and the per-frame step
 * DISPATCHES to that type's behaviour (updateChaser / updateRanged), then a
 * SHARED tail integrates knockback + wall collision using the type's radius.
 *
 * Types (stats in ENEMY_TYPES):
 *  - chaser (Phase 2): chase the player; on reaching attackRange, TELEGRAPH
 *    (stand + wind up — the dodge window) -> STRIKE (one melee damage check) ->
 *    RECOVER -> chase.
 *  - ranged (Phase 7.5): kite to preferredRange; when the player is in fireRange,
 *    TELEGRAPH -> STRIKE (fire ONE slow bolt) -> RECOVER (cooldown) -> kite.
 *
 * Movement collides with walls (same tilemap as the player) so visuals and
 * collision stay in sync.
 */

import { ENEMY_COMMON, ENEMY_TYPES, POOL, type EnemyType } from '../utils/constants';
import { resolveX, resolveY } from './Collision';
import { damagePlayer } from './Combat';
import { fireEnemyProjectile } from './EnemyProjectile';
import { damageMultForDepth, healthMultForDepth, speedMultForDepth } from './Difficulty';
import type { GameState } from './GameState';

/** Shared phase machine. For the chaser, `strike` is the melee hit; for the
 *  ranged type, `strike` is the shot-release window (it fires once within it). */
export type EnemyPhase = 'chase' | 'telegraph' | 'strike' | 'recover';

export interface Enemy {
  active: boolean;
  /** Which behaviour + stat block this enemy runs (see ENEMY_TYPES). */
  type: EnemyType;
  x: number;
  y: number;
  /** Previous sim-step position (render interpolation). */
  prevX: number;
  prevY: number;
  health: number;
  /** Move speed (world units/sec) — scaled by depth at spawn (Phase 7c). */
  moveSpeed: number;
  /** Strike/projectile damage — scaled by depth at spawn (Phase 7c). */
  attackDamage: number;
  phase: EnemyPhase;
  /** Countdown within the current phase, seconds. */
  timer: number;
  /** Hit-flash countdown, seconds. */
  flashTimer: number;
  /** Knockback velocity (decays), world units/sec. */
  kbVx: number;
  kbVy: number;
  /** Whether this strike has already resolved its single damage check / shot. */
  struck: boolean;
}

export function createEnemyPool(): Enemy[] {
  return Array.from({ length: POOL.enemies }, () => ({
    active: false,
    type: 'chaser' as EnemyType,
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    health: 0,
    moveSpeed: ENEMY_TYPES.chaser.moveSpeed,
    attackDamage: ENEMY_TYPES.chaser.attackDamage,
    phase: 'chase' as EnemyPhase,
    timer: 0,
    flashTimer: 0,
    kbVx: 0,
    kbVy: 0,
    struck: false,
  }));
}

/**
 * Activate a pooled enemy of `type` at (x, y), with stats scaled for `depth`
 * (Phase 7c; depth defaults to 1 = baseline, type defaults to chaser so existing
 * callers/tests are unchanged). The scaled values are stored per-enemy (the AI
 * reads e.moveSpeed / e.attackDamage). No-op (returns false) if the pool is full.
 */
export function spawnEnemy(
  pool: Enemy[],
  x: number,
  y: number,
  depth = 1,
  type: EnemyType = 'chaser',
): boolean {
  const stats = ENEMY_TYPES[type];
  for (const e of pool) {
    if (e.active) continue;
    e.active = true;
    e.type = type;
    e.x = x;
    e.y = y;
    e.prevX = x;
    e.prevY = y;
    e.health = stats.maxHealth * healthMultForDepth(depth);
    e.moveSpeed = stats.moveSpeed * speedMultForDepth(depth);
    e.attackDamage = stats.attackDamage * damageMultForDepth(depth);
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

/** Reused desired-velocity scratch — the per-type behaviour writes into it so the
 *  dispatch allocates nothing per enemy per frame. */
const _vel = { x: 0, y: 0 };

/** Chaser AI: chase -> telegraph -> strike (melee) -> recover. Writes _vel. */
function updateChaser(e: Enemy, state: GameState, dt: number, dx: number, dy: number, d: number): void {
  const C = ENEMY_TYPES.chaser;
  const { player } = state;
  _vel.x = 0;
  _vel.y = 0;
  switch (e.phase) {
    case 'chase':
      if (player.alive && d <= C.attackRange) {
        e.phase = 'telegraph';
        e.timer = C.telegraph;
      } else if (player.alive && d > 0) {
        _vel.x = (dx / d) * e.moveSpeed; // depth-scaled at spawn
        _vel.y = (dy / d) * e.moveSpeed;
      }
      break;
    case 'telegraph':
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'strike';
        e.timer = C.strike;
        e.struck = false;
      }
      break;
    case 'strike':
      if (!e.struck) {
        e.struck = true;
        if (player.alive && d <= C.attackReach) {
          damagePlayer(player, e.attackDamage, state); // depth-scaled at spawn
        }
      }
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'recover';
        e.timer = C.recover;
      }
      break;
    case 'recover':
      e.timer -= dt;
      if (e.timer <= 0) e.phase = 'chase';
      break;
  }
}

/** Ranged AI: kite to preferredRange -> telegraph -> strike (fire ONE bolt) ->
 *  recover (cooldown) -> kite. Stands still while telegraphing/firing (the tell);
 *  only kites in `chase`. Writes _vel. */
function updateRanged(e: Enemy, state: GameState, dt: number, dx: number, dy: number, d: number): void {
  const R = ENEMY_TYPES.ranged;
  const { player } = state;
  _vel.x = 0;
  _vel.y = 0;
  switch (e.phase) {
    case 'chase':
      if (player.alive && d > 0) {
        const ux = dx / d;
        const uy = dy / d;
        if (d > R.preferredRange + R.rangeBand) {
          _vel.x = ux * e.moveSpeed; // too far: close in
          _vel.y = uy * e.moveSpeed;
        } else if (d < R.preferredRange - R.rangeBand) {
          _vel.x = -ux * e.moveSpeed; // too close: back off (kite away)
          _vel.y = -uy * e.moveSpeed;
        } else {
          e.phase = 'telegraph'; // at standoff: open fire
          e.timer = R.telegraph;
        }
      }
      break;
    case 'telegraph':
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'strike';
        e.timer = R.strike;
        e.struck = false;
      }
      break;
    case 'strike':
      if (!e.struck) {
        e.struck = true;
        if (player.alive && d > 0) {
          // Fire ONE bolt toward the player's position at release (depth-scaled
          // damage carried per-bolt). Routes through damagePlayer on hit.
          fireEnemyProjectile(state.enemyProjectiles, e.x, e.y, dx / d, dy / d, e.attackDamage);
        }
      }
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'recover';
        e.timer = R.recover;
      }
      break;
    case 'recover':
      e.timer -= dt;
      if (e.timer <= 0) e.phase = 'chase';
      break;
  }
}

/** Advance every active enemy one fixed step against the shared game state. */
export function updateEnemies(state: GameState, dt: number): void {
  const { player, room, enemies } = state;
  const kbDecay = Math.pow(ENEMY_COMMON.knockbackDecay, dt);

  for (const e of enemies) {
    if (!e.active) continue;
    e.prevX = e.x;
    e.prevY = e.y;
    if (e.flashTimer > 0) e.flashTimer = Math.max(0, e.flashTimer - dt);

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy);

    // Per-type behaviour writes the desired velocity into _vel.
    if (e.type === 'ranged') updateRanged(e, state, dt, dx, dy, d);
    else updateChaser(e, state, dt, dx, dy, d);

    // Shared tail: integrate desired movement + decaying knockback, one axis at a
    // time so enemies stop/slide on walls exactly like the player. Per-type radius.
    const radius = ENEMY_TYPES[e.type].radius;
    e.kbVx *= kbDecay;
    e.kbVy *= kbDecay;
    const moveX = (_vel.x + e.kbVx) * dt;
    e.x = resolveX(e.x, e.y, moveX, radius, room);
    const moveY = (_vel.y + e.kbVy) * dt;
    e.y = resolveY(e.x, e.y, moveY, radius, room);
  }
}
