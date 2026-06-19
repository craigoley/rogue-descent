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
 * from the weak side (see `bossVulnerable`, used by Combat.damageEnemy). This arc
 * is the BASELINE for every boss; gimmicks layer ON it. GIMMICK #2 (adds) appends a
 * phase-2 SUMMON entry. GIMMICK #3 (knockback-interrupt) adds the CLEAVE entry — a
 * long, heavily-telegraphed heavy strike a weak-side KNOCKBACK hit CANCELS
 * mid-telegraph (Combat sets BossState.interruptHit; updateBoss consumes it),
 * rewarding the read with a shield-down STAGGER window.
 */

import { BOSS, ENEMY_TYPES } from '../utils/constants';
import { bossGimmickForDepth, bossHpForDepth, bossPhasesForDepth } from './Difficulty';
import { damagePlayer } from './Combat';
import type { Enemy } from './Enemy';
import type { GameState } from './GameState';
import type { Vec2 } from '../utils/math';

// IMPORT DIRECTION: this module has NO runtime import of Enemy (only `type Enemy`,
// erased at compile). The SUMMON strike (gimmick #2) RECORDS a pending-summon
// request on BossState; GameState performs the spawn side-effect (it owns
// spawnEnemy). So the runtime graph is one-directional — Enemy -> Boss (the
// updateBoss dispatch) and GameState -> {Boss, Enemy} — with no Enemy<->Boss cycle.

/** Boss gimmicks. The three rotation entries (#1 positioning, #2 adds, #3 knockback —
 *  interrupt the CLEAVE windup) PLUS 'final': the DISTINCT win-depth boss that COMBINES
 *  the summon (#2) AND cleave (#3) entries on the weak-side baseline — the climax that
 *  tests the whole toolkit at once. */
export type BossGimmick = 'positioning' | 'adds' | 'knockback' | 'final';

/** A recorded SUMMON request (gimmick #2): the boss's SUMMON strike sets this on
 *  BossState (data + intent only — no spawn), and GameState consumes it by
 *  spawning `count` adds along the line `origin + axis * (offset + k*spacing)`
 *  (BOSS.summon geometry), then clears it. Keeps spawnEnemy out of Boss. */
export interface PendingSummon {
  /** Adds to spawn this wave. */
  count: number;
  /** Line origin (the boss centre at strike time), world units. */
  originX: number;
  originY: number;
  /** Unit boss->player axis the column marches down (pierce-friendly). */
  axisX: number;
  axisY: number;
}

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
  /** GIMMICK #2: a SUMMON request recorded by the SUMMON strike and consumed +
   *  cleared by GameState (the spawn side-effect), or null when none is pending.
   *  This indirection keeps spawnEnemy out of Boss (no Enemy<->Boss cycle). */
  pendingSummon: PendingSummon | null;
  /** GIMMICK #3: one-frame signal SET by Combat.meleeAttack when a weak-side,
   *  knockback-track (knockbackLevel >= 1) melee hit lands on the boss, and
   *  read+cleared by updateBoss each step. Combat already touches state.boss
   *  (the inlined vulnerable check), so this needs NO Boss import — same
   *  Combat->Boss data direction, no cycle. Consumed only in the telegraph phase
   *  of an interruptible attack (else ignored). */
  interruptHit: boolean;
  /** GIMMICK #3: seconds remaining in the SHIELD-DOWN stagger after a successful
   *  interrupt. While > 0, Combat.damageEnemy bypasses the vulnerable-arc check
   *  (hits land from any angle) and the render shows the stagger tint. */
  staggerTimer: number;
}

/** One boss attack: a wind-up + active window + recovery, and a strike effect.
 *  Data-driven so #2/#3 are new entries, no rewrite. */
interface BossAttack {
  id: string;
  telegraph: number;
  strike: number;
  recover: number;
  /** GIMMICK #3: true if a weak-side knockback hit during the telegraph CANCELS this
   *  attack (only CLEAVE). Falsy attacks (slam, summon) ignore the interrupt signal. */
  interruptible?: boolean;
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
    const boss = state.boss;
    if (!boss) return;
    // GATED RE-SUMMON: if a previous wave is still alive, do nothing this cycle
    // (don't even record a request) — never more than one wave, no instant respawn.
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
    // RECORD the wave request (data + intent only). GameState performs the spawn
    // along this line — so Boss never imports spawnEnemy. The column marches down
    // the boss->player axis (pierce-friendly); off-arena cells are pulled back in
    // by the per-step room-rect clamp.
    boss.pendingSummon = { count: BOSS.summon.count, originX: e.x, originY: e.y, axisX: ux, axisY: uy };
  },
};

/** GIMMICK #3 — CLEAVE: the signature heavy strike. A LONG, clearly-telegraphed
 *  wind-up (BOSS.cleave.telegraph) hitting a bigger AoE for more damage than the
 *  slam. INTERRUPTIBLE: a weak-side knockback hit during the telegraph cancels it
 *  (updateBoss). DODGEABLE like the slam if not interrupted — same telegraph->
 *  strike->recover cycle, so the existing boss wind-up render is the tell. */
const CLEAVE: BossAttack = {
  id: 'cleave',
  telegraph: BOSS.cleave.telegraph,
  strike: BOSS.cleave.strike,
  recover: BOSS.cleave.recover,
  interruptible: true,
  run(e, state, d, phase2) {
    const reach =
      (ENEMY_TYPES.boss.attackReach + ENEMY_TYPES.boss.radius) *
      BOSS.cleave.reachMult *
      (phase2 ? BOSS.phase2.reachMult : 1);
    if (state.player.alive && d <= reach) {
      damagePlayer(state.player, e.attackDamage * BOSS.cleave.damageMult, state);
    }
  },
};

// Pre-allocated attack tables (returned by reference — no per-frame allocation).
const TABLE_SLAM: BossAttack[] = [SLAM];
const TABLE_SLAM_SUMMON: BossAttack[] = [SLAM, SUMMON];
const TABLE_SLAM_CLEAVE: BossAttack[] = [SLAM, CLEAVE];
/** FINAL boss ('final' gimmick), phase 2: the COMBINED table — slam + summon + cleave,
 *  the whole toolkit. Phase 1 stays SLAM+CLEAVE (the cleave-interrupt test); the SUMMON
 *  joins only at the 50% escalation, so it COMBINES (escalates), it doesn't spam from the
 *  start (mirrors how 'adds' gates its summon to phase 2). */
const TABLE_SLAM_SUMMON_CLEAVE: BossAttack[] = [SLAM, SUMMON, CLEAVE];

/** The attack TABLE for a gimmick + phase (exported for tests — pure). */
export function attacksFor(gimmick: BossGimmick, phase2: boolean): BossAttack[] {
  // FINAL (win-depth): cleave from the start, +summon at the phase-2 escalation.
  if (gimmick === 'final') return phase2 ? TABLE_SLAM_SUMMON_CLEAVE : TABLE_SLAM_CLEAVE;
  if (gimmick === 'adds' && phase2) return TABLE_SLAM_SUMMON;
  if (gimmick === 'knockback') return TABLE_SLAM_CLEAVE;
  return TABLE_SLAM;
}

/** Build the companion state for a freshly-spawned boss at `slot`. maxHealth uses
 *  bossHpForDepth (depth-1 gentle carve-out, depth >= 2 the 7c curve) — the SAME
 *  value Encounter overrides onto the Enemy's health, so the HP bar + 50% gate
 *  match the actual HP. */
export function createBossState(slot: number, depth: number, healthMult = 1): BossState {
  return {
    slot,
    outerPhase: 1,
    phases: bossPhasesForDepth(depth),
    gimmick: bossGimmickForDepth(depth),
    attackCursor: 0,
    vulnerableAngle: 0,
    // META L3 HEAT (Thick Skin): scale the bar's max to match the boss's actual HP (set
    // with the same mult in updateEncounterEntry), so the bar + 50% phase gate stay true.
    maxHealth: bossHpForDepth(depth) * healthMult,
    blockedFlash: 0,
    pendingSummon: null,
    interruptHit: false,
    staggerTimer: 0,
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

  // GIMMICK #3: read + CLEAR the one-frame interrupt signal (Combat set it earlier
  // THIS step — combat resolves before updateEnemies, so zero latency). Captured to
  // a local so it's honoured only in the telegraph case below; cleared regardless so
  // a hit outside a telegraph is a no-op (never queues for a later attack).
  const interrupted = boss.interruptHit;
  boss.interruptHit = false;

  // Phase escalation: a two-phase boss flips to phase 2 at <= 50% HP (one-way).
  if (boss.phases === 2 && boss.outerPhase === 1 && e.health <= boss.maxHealth * 0.5) {
    boss.outerPhase = 2;
  }
  const phase2 = boss.outerPhase === 2;

  // Tells decay.
  if (boss.blockedFlash > 0) boss.blockedFlash = Math.max(0, boss.blockedFlash - dt);
  // GIMMICK #3: the shield-down stagger window counts down (shield is down while > 0).
  if (boss.staggerTimer > 0) boss.staggerTimer = Math.max(0, boss.staggerTimer - dt);

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
      // GIMMICK #3 INTERRUPT: a weak-side knockback hit during an INTERRUPTIBLE
      // wind-up CANCELS the attack — skip 'strike' entirely (atk.run never fires ->
      // no strike damage), drop straight to recover, and open the shield-down
      // stagger. The cursor still advances on the recover->chase transition.
      if (interrupted && atk.interruptible) {
        e.phase = 'recover';
        e.timer = atk.recover;
        boss.staggerTimer = BOSS.interrupt.staggerDuration;
        break;
      }
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
