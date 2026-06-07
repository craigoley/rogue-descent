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
import { clamp } from '../utils/math';
import { resolveX, resolveY } from './Collision';
import { damageEnemy, damagePlayer } from './Combat';
import { fireEnemyProjectile } from './EnemyProjectile';
import { damageMultForDepth, healthMultForDepth, speedMultForDepth } from './Difficulty';
import { updateBoss } from './Boss';
import type { GameState } from './GameState';

/** Clamp `v` to the symmetric range [-limit, limit]. */
const clampAbs = (v: number, limit: number): number => (v > limit ? limit : v < -limit ? -limit : v);

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
  /** Which encounter room this enemy belongs to (set at spawn). Lets a room clear
   *  on ITS OWN enemies rather than the whole pool (so two rooms' enemies can't
   *  block each other's clear). -1 = unowned (e.g. an idle pooled slot). */
  roomIndex: number;
  /** STUN countdown, seconds (Phase 9 PR2, knockback level >= 2). While > 0 the
   *  AI is FROZEN (no decision-making) — but knockback velocity still integrates,
   *  so a stunned enemy is still shoved. Bosses are stun-immune (never set). 0 =
   *  not stunned. Reset on spawn so a recycled pool slot never inherits a stun. */
  stunTimer: number;
  /** BURN countdown, seconds (synergy arc PR2). While > 0 the enemy takes burnDps ×
   *  dt damage each step (a DoT tick routed through damageEnemy with isDirect=false).
   *  Set/REFRESHED by a direct hit when the player owns burn; never stacks. Reset on
   *  spawn so a recycled slot never inherits a burn. 0 = not burning. */
  burnTimer: number;
  /** Burn damage-per-second for the CURRENT ignition (BURN_LEVELS.dps[level],
   *  overwritten on each re-ignite — refresh-not-stack). Unused while burnTimer 0. */
  burnDps: number;
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
    roomIndex: -1,
    stunTimer: 0,
    burnTimer: 0,
    burnDps: 0,
  }));
}

/**
 * Activate a pooled enemy of `type` at (x, y), with stats scaled for `depth`
 * (Phase 7c; depth defaults to 1 = baseline, type defaults to chaser so existing
 * callers/tests are unchanged). `roomIndex` tags which encounter room owns this
 * enemy (default -1 = unowned, for tests / non-encounter spawns). The scaled
 * values are stored per-enemy (the AI reads e.moveSpeed / e.attackDamage). No-op
 * (returns false) if the pool is full.
 */
export function spawnEnemy(
  pool: Enemy[],
  x: number,
  y: number,
  depth = 1,
  type: EnemyType = 'chaser',
  roomIndex = -1,
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
    e.roomIndex = roomIndex;
    e.stunTimer = 0; // recycled slot never inherits a stun
    e.burnTimer = 0; // ...nor a burn
    e.burnDps = 0;
    return true;
  }
  return false;
}

export function activeEnemyCount(pool: Enemy[]): number {
  let n = 0;
  for (const e of pool) if (e.active) n++;
  return n;
}

/** Living enemies that belong to `roomIndex` — so a room clears on ITS OWN
 *  enemies, not the whole pool (two rooms' enemies can't block each other). */
export function roomEnemyCount(pool: Enemy[], roomIndex: number): number {
  let n = 0;
  for (const e of pool) if (e.active && e.roomIndex === roomIndex) n++;
  return n;
}

/** Reused desired-velocity scratch — the per-type behaviour writes into it so the
 *  dispatch allocates nothing per enemy per frame. */
const _vel = { x: 0, y: 0 };

/** Boss-add AI (Phase 8, gimmick #2): a weak summoned minion that marches STRAIGHT
 *  at the player and melees — chase -> telegraph -> strike -> recover, same shape
 *  as the chaser but reading its OWN (weak) ENEMY_TYPES.bossadd timings. No kiting,
 *  no flock-surround, so a summoned column stays pierce-friendly. Writes _vel. */
function updateBossAdd(e: Enemy, state: GameState, dt: number, dx: number, dy: number, d: number): void {
  const A = ENEMY_TYPES.bossadd;
  const { player } = state;
  _vel.x = 0;
  _vel.y = 0;
  switch (e.phase) {
    case 'chase':
      if (player.alive && d <= A.attackRange) {
        e.phase = 'telegraph';
        e.timer = A.telegraph;
      } else if (player.alive && d > 0) {
        _vel.x = (dx / d) * e.moveSpeed; // depth-scaled at spawn
        _vel.y = (dy / d) * e.moveSpeed;
      }
      break;
    case 'telegraph':
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'strike';
        e.timer = A.strike;
        e.struck = false;
      }
      break;
    case 'strike':
      if (!e.struck) {
        e.struck = true;
        if (player.alive && d <= A.attackReach) damagePlayer(player, e.attackDamage, state);
      }
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'recover';
        e.timer = A.recover;
      }
      break;
    case 'recover':
      e.timer -= dt;
      if (e.timer <= 0) e.phase = 'chase';
      break;
  }
}

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

/** Swarmer AI: FLOCK-surround (steer toward player + separate from nearby
 *  swarmers, so a few of them encircle instead of stacking) -> at close range
 *  LUNGE (a short MOVING wind-up, then a committed dart) -> recover. Distinct
 *  from the chaser's planted telegraph + stationary strike. Pure: reads other
 *  swarmers' positions from state.enemies in-loop (deterministic by pool order).
 *  Writes _vel. */
function updateSwarmer(e: Enemy, state: GameState, dt: number, dx: number, dy: number, d: number): void {
  const S = ENEMY_TYPES.swarmer;
  const { player, enemies } = state;
  _vel.x = 0;
  _vel.y = 0;
  switch (e.phase) {
    case 'chase': {
      if (!player.alive || d === 0) break;
      // Commit the lunge once close enough.
      if (d <= S.lungeRange) {
        e.phase = 'telegraph';
        e.timer = S.telegraph;
        break;
      }
      // FLOCK steer = pull toward the player + push off nearby swarmers.
      let sx = (dx / d) * S.attractWeight;
      let sy = (dy / d) * S.attractWeight;
      for (const o of enemies) {
        if (o === e || !o.active || o.type !== 'swarmer') continue;
        const ox = e.x - o.x;
        const oy = e.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od > 0 && od < S.sepRadius) {
          // Closer neighbours push harder (falls off to 0 at sepRadius).
          const push = (S.sepRadius - od) / S.sepRadius / od;
          sx += ox * push * S.sepWeight;
          sy += oy * push * S.sepWeight;
        }
      }
      const sl = Math.hypot(sx, sy);
      if (sl > 0) {
        _vel.x = (sx / sl) * e.moveSpeed;
        _vel.y = (sy / sl) * e.moveSpeed;
      }
      break;
    }
    case 'telegraph':
      // MOVING wind-up (the frantic tell): keep drifting toward the player at the
      // flock speed while winding up — unlike the chaser, which stands still.
      if (player.alive && d > 0) {
        _vel.x = (dx / d) * e.moveSpeed;
        _vel.y = (dy / d) * e.moveSpeed;
      }
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'strike';
        e.timer = S.strike;
        e.struck = false;
      }
      break;
    case 'strike':
      // The DART: a fast committed drive at the player, with one damage check.
      if (player.alive && d > 0) {
        _vel.x = (dx / d) * S.lungeSpeed;
        _vel.y = (dy / d) * S.lungeSpeed;
      }
      if (!e.struck && player.alive && d <= S.attackReach) {
        e.struck = true;
        damagePlayer(player, e.attackDamage, state); // depth-scaled at spawn
      }
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'recover';
        e.timer = S.recover;
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

    // SYNERGY ARC PR2 — BURN tick (DoT). Continuous dps × dt, deterministic (fixed
    // SIM_DT, no accumulator, no RNG). Ticks BEFORE the stun/AI branch so a stunned
    // enemy still burns. Routed through damageEnemy with isDirect=FALSE so it (a)
    // never lifesteals (#66 guard), (b) never re-ignites itself, (c) never knocks
    // back (force 0), and (d) hits the SAME death/kill/drop path as a direct hit —
    // a burn-tick kill is detected by GameState's post-updateEnemies death diff +
    // counted by updateEncounterResolve exactly like a melee/projectile kill. The
    // tick is clamped to the remaining timer so the final partial step never
    // over-applies. Boss: burns only from landed weak-side hits (apply is gated on
    // the landed boolean in damageEnemy), and its death routes the same way.
    if (e.burnTimer > 0) {
      const tick = Math.min(dt, e.burnTimer); // clamp the final partial step's damage
      e.burnTimer = Math.max(0, e.burnTimer - dt); // clamp to 0 (mirrors stun/flash timers)
      damageEnemy(e, e.burnDps * tick, 0, 0, 0, state, false);
      if (!e.active) continue; // burned to death this step — slot freed, skip the rest
    }

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const d = Math.hypot(dx, dy);

    // STUN (Phase 9 PR2): a stunned enemy FREEZES its AI — skip the per-type
    // behaviour and hold its phase/timer — but the integrate tail below still
    // runs, so knockback keeps shoving it (stun freezes decisions, not physics).
    // Uniform across all types; the boss is never stunned (set-side exemption).
    if (e.stunTimer > 0) {
      e.stunTimer = Math.max(0, e.stunTimer - dt);
      _vel.x = 0;
      _vel.y = 0;
    } else {
      // Per-type behaviour writes the desired velocity into _vel.
      switch (e.type) {
        case 'ranged':
          updateRanged(e, state, dt, dx, dy, d);
          break;
        case 'swarmer':
          updateSwarmer(e, state, dt, dx, dy, d);
          break;
        case 'boss':
          updateBoss(e, state, dt, dx, dy, d, _vel);
          break;
        case 'bossadd':
          updateBossAdd(e, state, dt, dx, dy, d);
          break;
        default:
          updateChaser(e, state, dt, dx, dy, d);
      }
    }

    // Shared tail: integrate desired movement + decaying knockback, one axis at a
    // time so enemies stop/slide on walls exactly like the player. Per-type radius.
    const radius = ENEMY_TYPES[e.type].radius;
    e.kbVx *= kbDecay;
    e.kbVy *= kbDecay;
    // CAP the per-step MOVE below one tile (not the stored kbVx/kbVy — those still
    // decay over frames, so the shove keeps its strength; it just can't cross a
    // tile in a single step). This preserves resolveX/resolveY's single-resolve
    // no-tunnel guarantee for ANY knockback velocity (incl. boss-scale).
    const maxStep = ENEMY_COMMON.maxStepTiles * room.tileSize;
    const moveX = clampAbs((_vel.x + e.kbVx) * dt, maxStep);
    e.x = resolveX(e.x, e.y, moveX, radius, room);
    const moveY = clampAbs((_vel.y + e.kbVy) * dt, maxStep);
    e.y = resolveY(e.x, e.y, moveY, radius, room);

    // Belt-and-suspenders: keep every active enemy INSIDE its room's rect (the
    // carved floor; walls are outside it), so an enemy can never end a step in the
    // sealed-off corridor and become permanently unreachable -> a room that never
    // clears. Enemies only ever belong to the active room; guard if there isn't
    // one (defensive — shouldn't happen while an enemy is alive).
    if (state.activeRoom >= 0) {
      const r = state.rooms[state.activeRoom].rect;
      const ts = room.tileSize;
      e.x = clamp(e.x, r.x * ts + radius, (r.x + r.w) * ts - radius);
      e.y = clamp(e.y, r.y * ts + radius, (r.y + r.h) * ts - radius);
    }
  }
}
