/**
 * Shared pure combat machinery: aim resolution and the damage application that
 * BOTH attacks and the enemy feed into. Kept in one place so melee, ranged and
 * enemy strikes apply identical feedback (flash, knockback, particles, hit-stop,
 * shake). ZERO three/DOM.
 *
 * Runtime imports are leaf-only (Particle + constants), so this never forms an
 * import cycle with Enemy/Projectile/GameState (which import it).
 */

import { BOSS, BURN_LEVELS, DASH_STRIKE, ENEMY_COMMON, ENEMY_TYPES, KNOCKBACK_LEVELS, LIFESTEAL_LEVELS, MELEE, MELEE_LEVELS, PARTICLE, PLAYER_COMBAT, SHAKE, TUNING } from '../utils/constants';
import { spawnParticles } from './Particle';
import { isoRotate, type InputIntent } from './Input';
import type { Enemy } from './Enemy';
import type { PlayerState } from './Player';
import type { GameState } from './GameState';
import type { Vec2 } from '../utils/math';

/**
 * Resolve the attack aim direction into a WORLD unit vector, written into `out`
 * (no allocation). Uses the intent's aim (screen axes → world via the same iso
 * rotation as movement) when present; otherwise falls back to the player's
 * facing (= last move direction), so keyboard-only / no-aim still attacks
 * sensibly.
 */
export function aimDirection(player: PlayerState, intent: InputIntent, out: Vec2): Vec2 {
  const aLen = Math.hypot(intent.aimX, intent.aimY);
  if (aLen > 0) {
    const r = isoRotate(intent.aimX, intent.aimY);
    const len = Math.hypot(r.x, r.y) || 1;
    out.x = r.x / len;
    out.y = r.y / len;
  } else {
    out.x = player.facingX;
    out.y = player.facingY;
  }
  return out;
}

/** Apply damage to an enemy with full hit feedback (flash, knockback, sparks,
 *  hit-stop). Kills + emits a death burst when health reaches zero. Returns true if
 *  the hit LANDED (damage/force applied), false if a boss BLOCKED it on the armored
 *  side — the caller (meleeAttack) uses this as the "weak-side hit" signal for the
 *  gimmick-#3 interrupt.
 *
 *  `isDirect` (default true) marks a DIRECT player hit (melee / ranged / dash-strike)
 *  vs an over-time TICK (synergy arc PR2 burn, which will pass false). LIFESTEAL only
 *  heals on direct hits — a DoT tick must NOT lifesteal (bound E: no passive infinite
 *  sustain). Existing callers are all direct, so they keep the default. */
export function damageEnemy(
  enemy: Enemy,
  amount: number,
  kbDirX: number,
  kbDirY: number,
  kbForce: number,
  state: GameState,
  isDirect = true,
): boolean {
  // GIMMICK #1 (Phase 8): a boss only takes damage from its VULNERABLE side. A
  // hit from the armored side is BLOCKED — no health loss (blockedDamageMult 0),
  // no knockback, no hit-stop; it flashes the SHIELD tell instead. kbDir is the
  // attacker -> enemy direction, so boss -> attacker is its negation; the hit is
  // vulnerable when that lies within half the weak arc. Inlined (not imported
  // from Boss) to avoid a Combat<->Boss import cycle; mirrors bossVulnerable().
  // GIMMICK #3: while staggerTimer > 0 the shield is DOWN — skip this block so a
  // successful interrupt lets hits land from ANY angle (the free-hit reward).
  if (enemy.type === 'boss' && state.boss && state.boss.staggerTimer <= 0) {
    const len = Math.hypot(kbDirX, kbDirY) || 1;
    const dot =
      (-kbDirX / len) * Math.cos(state.boss.vulnerableAngle) +
      (-kbDirY / len) * Math.sin(state.boss.vulnerableAngle);
    if (dot < Math.cos(BOSS.vulnerableArc / 2)) {
      state.boss.blockedFlash = ENEMY_COMMON.flash; // shield "clang" tell
      spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.hitCount);
      enemy.health -= amount * BOSS.blockedDamageMult; // 0 => fully negated
      if (enemy.health <= 0) {
        enemy.active = false;
        spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.deathCount);
      }
      return false; // BLOCKED — armored side (not a weak-side hit)
    }
  }
  enemy.health -= amount;
  // DIRECT-hit feedback + on-hit effects (flash, knockback, sparks, hit-stop,
  // lifesteal, burn-ignite). ALL gated on isDirect so a burn TICK (isDirect=false,
  // every frame) does NOT: white-flash over the burn tint, spam hit particles,
  // micro-freeze via hit-stop, lifesteal, or re-ignite itself. A tick only subtracts
  // health + falls through to the shared death path below.
  if (isDirect) {
    enemy.flashTimer = ENEMY_COMMON.flash;
    // Per-type mass: light enemies (swarmers) get launched farther by the same
    // impulse (chaser/ranged mult = 1, so this is identity for them).
    const kb = kbForce * ENEMY_TYPES[enemy.type].knockbackMult;
    enemy.kbVx += kbDirX * kb;
    enemy.kbVy += kbDirY * kb;
    spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.hitCount);
    // Hit-stop sells the impact: freeze briefly (take the strongest pending stop).
    if (TUNING.hitstop > state.hitstopTimer) state.hitstopTimer = TUNING.hitstop;
    // SYNERGY ARC PR1 — LIFESTEAL: heal a fraction of damage dealt. One hook here =
    // it auto-multiplies with melee / multishot / pierce / dash-strike (every direct
    // hit routes through this call). Capped per hit + clamped to max HP — sustain,
    // not a heal button. No-op at level 0 or when already at max HP.
    if (amount > 0) {
      const frac = LIFESTEAL_LEVELS.frac[state.player.lifestealLevel];
      if (frac > 0 && state.player.health < PLAYER_COMBAT.maxHealth) {
        const heal = Math.min(amount * frac, LIFESTEAL_LEVELS.maxPerHit);
        state.player.health = Math.min(PLAYER_COMBAT.maxHealth, state.player.health + heal);
      }
    }
    // SYNERGY ARC PR2 — BURN: a direct landed hit IGNITES (refresh-not-stack). Same
    // one-hook auto-multiply (N shots / a pierced line all ignite). The isDirect gate
    // means a tick never re-ignites itself (no infinite refresh); the armored-side
    // block returned earlier (landed=false) so a blocked boss hit can't ignite.
    if (state.player.burnLevel > 0) {
      enemy.burnTimer = BURN_LEVELS.duration;
      enemy.burnDps = BURN_LEVELS.dps[state.player.burnLevel];
    }
  }
  if (enemy.health <= 0) {
    enemy.active = false;
    spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.deathCount);
  }
  return true; // LANDED (for a boss: a weak-side hit — the interrupt signal source)
}

/** Apply a knockback impulse ONLY — no damage, death, hit-stop or particles. Used
 *  by the level-III melee AoE to shove (and stun) out-of-arc, in-range enemies
 *  without nuking them (crowd-control, not crowd-damage). Mirrors the kb-impulse
 *  lines of damageEnemy, with the same per-type mass (knockbackMult). */
export function applyKnockback(enemy: Enemy, dirX: number, dirY: number, force: number): void {
  const kb = force * ENEMY_TYPES[enemy.type].knockbackMult;
  enemy.kbVx += dirX * kb;
  enemy.kbVy += dirY * kb;
}

/** Apply damage to the player unless invulnerable (dash i-frames or post-hit
 *  i-frames). Triggers flash, brief i-frames and a screen shake. Death itself
 *  is detected by GameState.update (health <= 0). */
export function damagePlayer(player: PlayerState, amount: number, state: GameState): void {
  // Dash i-frames negate the hit — and, unlike the silent post-hit window, this
  // is the DODGE: reward it so the player SEES they pulled it off. Damage is
  // still fully negated (logic unchanged); only feedback is added.
  if (player.iframeTimer > 0) {
    player.dodgeFxTimer = PLAYER_COMBAT.dodgeFx;
    spawnParticles(state.particles, player.x, player.y, PARTICLE.dodgeCount);
    if (PLAYER_COMBAT.dodgeHitstop > state.hitstopTimer) {
      state.hitstopTimer = PLAYER_COMBAT.dodgeHitstop; // tiny time-dilation cue
    }
    return;
  }
  if (player.hitInvulnTimer > 0) return; // post-hit i-frames: silent
  player.health -= amount;
  player.hitFlashTimer = PLAYER_COMBAT.hitFlash;
  player.hitInvulnTimer = PLAYER_COMBAT.hitInvuln;
  state.shakeTimer = SHAKE.duration;
}

/**
 * DASH-STRIKE (Phase: dash-strike powerup): while the player is mid-dash AND holds
 * the dashStrike powerup, damage every active enemy the player sweeps over — once
 * each per dash (player.dashHits dedups across the burst's ~10 sim steps). Reuses
 * the radial overlap (NO arc, unlike melee) + the shared damageEnemy path; the
 * dash direction is the knockback dir. Caller gates on `dashTimer > 0 && dashStrike`.
 */
export function dashStrike(state: GameState): void {
  const { player, enemies } = state;
  for (let ei = 0; ei < enemies.length; ei++) {
    const e = enemies[ei];
    if (!e.active || player.dashHits.has(ei)) continue;
    const reach = DASH_STRIKE.radius + ENEMY_TYPES[e.type].radius; // per-type hitbox
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    player.dashHits.add(ei);
    damageEnemy(e, DASH_STRIKE.damage, player.dashDirX, player.dashDirY, DASH_STRIKE.knockback, state);
  }
}

/**
 * Resolve a melee swing: damage every active enemy within MELEE.range and inside
 * the swing arc (half-angle MELEE.halfArc) around the unit aim direction
 * (aimX, aimY). High damage, but you must be close — the risk side of the
 * close-vs-far tension. Pure; no allocation.
 */
export function meleeAttack(state: GameState, aimX: number, aimY: number): void {
  const { player, enemies } = state;
  // Phase 9 MELEE level: damage scales (× over the live TUNING.meleeDamage so the
  // ?debug slider still drives the base); reach + arc widen only at the cap (III).
  const ml = player.meleeLevel;
  const damage = TUNING.meleeDamage * MELEE_LEVELS.damageMult[ml];
  const reachBase = MELEE.range * MELEE_LEVELS.reachMult[ml];
  const arcCos = Math.cos(MELEE.halfArc * MELEE_LEVELS.arcMult[ml]);
  // Phase 9 KNOCKBACK level: shove force scales (level 0 = base MELEE.knockback).
  // II+ also STUNS the hit enemy; III adds an AoE that shoves+stuns ALL in-range
  // enemies (out-of-arc ones take force+stun only — no damage — crowd-control).
  const kbLevel = player.knockbackLevel;
  const kbForce = KNOCKBACK_LEVELS.force[kbLevel];
  const aoe = kbLevel === 3;
  const stunOn = kbLevel >= 2;
  for (const e of enemies) {
    if (!e.active) continue;
    const er = ENEMY_TYPES[e.type].radius; // per-type hitbox
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) continue;
    const ux = dx / d;
    const uy = dy / d;
    // In the swing if within reach AND inside the arc (the damage zone).
    const inArc = d <= reachBase + er && ux * aimX + uy * aimY >= arcCos;
    if (inArc) {
      const landed = damageEnemy(e, damage, ux, uy, kbForce, state); // damage + force
      // GIMMICK #3 INTERRUPT: a weak-side (landed) knockback-track hit on the boss
      // signals updateBoss to CANCEL an interruptible telegraph. `landed` ⇒ the hit
      // connected on the vulnerable side (the armored side returns false), so
      // positioning is implicit. Gated on the knockback POWERUP (kbLevel >= 1) — base
      // melee always carries force[0], so "has force" can't be the gate. Dash-strike
      // routes through damageEnemy but never sets this (knockback-track exclusive).
      if (landed && e.type === 'boss' && kbLevel >= 1 && state.boss) {
        state.boss.interruptHit = true;
      }
    } else if (aoe && d <= KNOCKBACK_LEVELS.aoeRadius + er) {
      applyKnockback(e, ux, uy, kbForce); // AoE: force only, no damage
    } else {
      continue; // out of the swing AND out of the AoE
    }
    // STUN (level >= 2): freeze the enemy's AI. Bosses are STUN-IMMUNE — the force
    // above still applies (via their knockbackMult); only the AI freeze is exempt.
    if (stunOn && e.type !== 'boss') e.stunTimer = KNOCKBACK_LEVELS.stunDuration;
  }
}
