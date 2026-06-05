/**
 * Boss behaviour (Phase 8). Pure: ZERO three/DOM. The boss IS a pooled `Enemy`
 * of type 'boss' (so it reuses every weapon hit-test, damageEnemy + knockback,
 * and death -> roomEnemyCount -> room clears -> descendIfReady — the gating we
 * hardened in #39/#42/#43). The RICH behaviour lives here in `BossState`
 * (companion to the pooled Enemy, indexed by its pool slot), keeping bloat OUT of
 * the uniform Enemy struct.
 *
 * STATE MACHINE: an OUTER phase (1 vs 2, HP-gated at 50%) + a data-driven
 * per-phase ATTACK TABLE feeding the EXISTING telegraph -> strike -> recover
 * cycle (on the pooled Enemy's phase/timer/struck). Phase 2 = the SAME attacks
 * AMPLIFIED (faster telegraph / bigger reach), not new moves.
 *
 * GIMMICK #1 (positioning/shield): a rotating VULNERABLE arc — damage only counts
 * from the weak side (see `bossVulnerable`, used by Combat.damageEnemy). Gimmicks
 * #2 (adds) and #3 (knockback-interrupt) slot in as FUTURE attack-table entries.
 */

import { BOSS, ENEMY_TYPES } from '../utils/constants';
import { bossGimmickForDepth, bossPhasesForDepth, healthMultForDepth } from './Difficulty';
import { damagePlayer } from './Combat';
import { spawnEnemy } from './Enemy';
import type { Enemy } from './Enemy';
import type { GameState } from './GameState';
import type { Vec2 } from '../utils/math';

// NOTE on imports: Enemy.ts runtime-imports updateBoss (the dispatch) and this
// module runtime-imports spawnEnemy (gimmick #2's SUMMON), forming an Enemy<->Boss
// cycle. It is BENIGN: both bindings are used only at CALL time (inside functions),
// never at module-eval top level, so ESM's live bindings resolve them fine.

/** Boss gimmicks (the rotation roster in Difficulty.BOSS_GIMMICKS). #1
 *  positioning + #2 adds are built; #3 (knockback-interrupt) is the last entry. */
export type BossGimmick = 'positioning' | 'adds';

export interface BossState {
  /** Pool index of the boss Enemy (its liveness/health/position live there). */
  slot: number;
  /** Current outer phase: 2 once a two-phase boss drops to <= 50% HP. */
  outerPhase: 1 | 2;
  /** Max phases for this depth (1 = never escalates; see bossPhasesForDepth). */
  phases: 1 | 2;
  gimmick: BossGimmick;
  /** Cursor into the per-phase attack table (advances each recover). */
  attackCursor: number;
  /** GIMMICK #1: outward direction (radians) the vulnerable weak-point faces;
   *  rotates so the player must reposition. */
  vulnerableAngle: number;
  /** Boss max HP (= the depth-scaled health at spawn) — for the 50% gate + HP bar. */
  maxHealth: number;
  /** Render tell: seconds remaining to flash the SHIELD (a blocked, armored-side
   *  hit). Distinct from the Enemy.flashTimer white hit-flash (a weak-side hit). */
  blockedFlash: number;
}

/** One boss attack: a wind-up + active window + recovery, and a strike effect.
 *  Data-driven so #2/#3 are new entries, no rewrite. */
interface BossAttack {
  id: string;
  telegraph: number;
  strike: number;
  recover: number;
  /** Execute the strike. `phase2` selects amplified params (same move, escalated). */
  run(e: Enemy, state: GameState, d: number, phase2: boolean): void;
}

/** The baseline SLAM: a big telegraphed AoE around the boss. Dodge by dashing;
 *  reposition to the weak side to damage the boss. */
const SLAM: BossAttack = {
  id: 'slam',
  telegraph: ENEMY_TYPES.boss.telegraph,
  strike: ENEMY_TYPES.boss.strike,
  recover: ENEMY_TYPES.boss.recover,
  run(e, state, d, phase2) {
    const reach =
      (ENEMY_TYPES.boss.attackReach + ENEMY_TYPES.boss.radius) *
      (phase2 ? BOSS.phase2.reachMult : 1);
    if (state.player.alive && d <= reach) damagePlayer(state.player, e.attackDamage, state);
  },
};

/** GIMMICK #2 — SUMMON ADDS (phase-2-only table entry). Spawns a FINITE wave of
 *  weak adds in a LINE on the boss->player axis (a column a single PIERCE shot
 *  skewers — the toolkit this gimmick tests). GATED: no-ops while any add from
 *  this wave is still alive, so there's never more than one wave and no instant
 *  respawn (pressure, not a grind). The wave is despawned on boss death (the
 *  fight ends — see GameState). Goes through the normal telegraph->strike->recover
 *  cycle, so the existing boss wind-up render is the summon tell. */
const SUMMON: BossAttack = {
  id: 'summon',
  telegraph: BOSS.summon.telegraph,
  strike: BOSS.summon.strike,
  recover: BOSS.summon.recover,
  // phase2 unused (summon already only runs in phase 2) — omit the 4th param.
  run(e, state, d) {
    // GATED RE-SUMMON: if a previous wave is still alive, do nothing this cycle.
    for (const a of state.enemies) {
      if (a.active && a.type === 'bossadd' && a.roomIndex === state.bossRoom) return;
    }
    // Unit vector boss -> player (the spawn line); default axis if coincident.
    let ux = 1;
    let uy = 0;
    if (d > 0) {
      ux = (state.player.x - e.x) / d;
      uy = (state.player.y - e.y) / d;
    }
    // A column of adds marching down the axis toward the player (pierce-friendly).
    // Off-arena spawns are pulled back in by the per-step room-rect clamp.
    for (let k = 0; k < BOSS.summon.count; k++) {
      const dist = BOSS.summon.lineOffset + k * BOSS.summon.lineSpacing;
      spawnEnemy(state.enemies, e.x + ux * dist, e.y + uy * dist, state.run.depth, 'bossadd', state.bossRoom);
    }
  },
};

/** The active attack table for a (gimmick, phase). Gimmick-aware selection is the
 *  one framework seam #44 anticipated: positioning is an always-on modifier so it
 *  adds no entries; the adds gimmick contributes SUMMON, but only in phase 2 (so a
 *  single-phase boss never summons). The telegraph->strike->recover loop + the
 *  BossAttack shape are unchanged — new gimmicks just add a branch here. */
function attacksFor(gimmick: BossGimmick, phase2: boolean): BossAttack[] {
  if (gimmick === 'adds' && phase2) return [SLAM, SUMMON];
  return [SLAM];
}

/** Build the companion state for a freshly-spawned boss at `slot` (its Enemy
 *  health was set to ENEMY_TYPES.boss.maxHealth * depth mult by spawnEnemy). */
export function createBossState(slot: number, depth: number): BossState {
  return {
    slot,
    outerPhase: 1,
    phases: bossPhasesForDepth(depth),
    gimmick: bossGimmickForDepth(depth),
    attackCursor: 0,
    vulnerableAngle: 0,
    maxHealth: ENEMY_TYPES.boss.maxHealth * healthMultForDepth(depth),
    blockedFlash: 0,
  };
}

/**
 * Is a hit from direction (hitDirX, hitDirY) — attacker -> boss, the same vector
 * damageEnemy uses for knockback — landing on the VULNERABLE side? The weak-point
 * faces `vulnerableAngle` (outward); a vulnerable hit comes FROM that side, so the
 * boss->attacker direction (-hitDir) must lie within half the arc of the weak dir.
 * Pure — Combat.damageEnemy inlines the equivalent check (to avoid an import
 * cycle); this is exported for tests + updateBoss.
 */
export function bossVulnerable(vulnerableAngle: number, hitDirX: number, hitDirY: number): boolean {
  const wx = Math.cos(vulnerableAngle);
  const wy = Math.sin(vulnerableAngle);
  // boss -> attacker is the opposite of the hit direction.
  const len = Math.hypot(hitDirX, hitDirY) || 1;
  const ax = -hitDirX / len;
  const ay = -hitDirY / len;
  return ax * wx + ay * wy >= Math.cos(BOSS.vulnerableArc / 2);
}

/** Advance the boss one step. Writes desired movement into `vel` (the shared
 *  enemy scratch). Drives the attack table through the Enemy phase machine. */
export function updateBoss(
  e: Enemy,
  state: GameState,
  dt: number,
  dx: number,
  dy: number,
  d: number,
  vel: Vec2,
): void {
  vel.x = 0;
  vel.y = 0;
  const boss = state.boss;
  if (!boss) return; // safety: no companion state -> stand still
  const { player } = state;

  // Phase escalation: a two-phase boss flips to phase 2 at <= 50% HP (one-way).
  if (boss.phases === 2 && boss.outerPhase === 1 && e.health <= boss.maxHealth * 0.5) {
    boss.outerPhase = 2;
  }
  const phase2 = boss.outerPhase === 2;

  // Tells decay.
  if (boss.blockedFlash > 0) boss.blockedFlash = Math.max(0, boss.blockedFlash - dt);

  // GIMMICK #1: rotate the vulnerable angle (faster in phase 2) so the player
  // must keep repositioning to the weak side.
  const rot = BOSS.vulnerableRotateRate * (phase2 ? BOSS.vulnerableRotatePhase2Mult : 1);
  boss.vulnerableAngle = (boss.vulnerableAngle + rot * dt) % (Math.PI * 2);

  const table = attacksFor(boss.gimmick, phase2);
  const atk = table[boss.attackCursor % table.length];
  const teleMult = phase2 ? BOSS.phase2.telegraphMult : 1;

  switch (e.phase) {
    case 'chase': {
      if (!player.alive || d === 0) break;
      const engage = (ENEMY_TYPES.boss.attackReach + ENEMY_TYPES.boss.radius) * (phase2 ? BOSS.phase2.reachMult : 1);
      if (d <= engage) {
        // In range: commit the attack (big telegraph).
        e.phase = 'telegraph';
        e.timer = atk.telegraph * teleMult;
        e.struck = false;
      } else {
        // Slowly close so the player can't just walk away forever.
        vel.x = (dx / d) * e.moveSpeed;
        vel.y = (dy / d) * e.moveSpeed;
      }
      break;
    }
    case 'telegraph':
      e.timer -= dt; // stand + wind up (the big, readable tell)
      if (e.timer <= 0) {
        e.phase = 'strike';
        e.timer = atk.strike;
      }
      break;
    case 'strike':
      if (!e.struck) {
        e.struck = true;
        atk.run(e, state, d, phase2);
      }
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'recover';
        e.timer = atk.recover;
      }
      break;
    case 'recover':
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'chase';
        boss.attackCursor++; // advance to the next attack in the table
      }
      break;
  }
}
