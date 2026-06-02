/**
 * Shared pure combat machinery: aim resolution and the damage application that
 * BOTH attacks and the enemy feed into. Kept in one place so melee, ranged and
 * enemy strikes apply identical feedback (flash, knockback, particles, hit-stop,
 * shake). ZERO three/DOM.
 *
 * Runtime imports are leaf-only (Particle + constants), so this never forms an
 * import cycle with Enemy/Projectile/GameState (which import it).
 */

import { ENEMY, MELEE, PARTICLE, PLAYER_COMBAT, SHAKE, TUNING } from '../utils/constants';
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
 *  hit-stop). Kills + emits a death burst when health reaches zero. */
export function damageEnemy(
  enemy: Enemy,
  amount: number,
  kbDirX: number,
  kbDirY: number,
  kbForce: number,
  state: GameState,
): void {
  enemy.health -= amount;
  enemy.flashTimer = ENEMY.flash;
  enemy.kbVx += kbDirX * kbForce;
  enemy.kbVy += kbDirY * kbForce;
  spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.hitCount);
  // Hit-stop sells the impact: freeze briefly (take the strongest pending stop).
  if (TUNING.hitstop > state.hitstopTimer) state.hitstopTimer = TUNING.hitstop;
  if (enemy.health <= 0) {
    enemy.active = false;
    spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.deathCount);
  }
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
 * Resolve a melee swing: damage every active enemy within MELEE.range and inside
 * the swing arc (half-angle MELEE.halfArc) around the unit aim direction
 * (aimX, aimY). High damage, but you must be close — the risk side of the
 * close-vs-far tension. Pure; no allocation.
 */
export function meleeAttack(state: GameState, aimX: number, aimY: number): void {
  const { player, enemies } = state;
  const reach = MELEE.range + ENEMY.radius;
  const arcCos = Math.cos(MELEE.halfArc);
  for (const e of enemies) {
    if (!e.active) continue;
    const dx = e.x - player.x;
    const dy = e.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d > reach || d === 0) continue;
    // Within the arc if the angle to the enemy is <= halfArc from the aim dir.
    const dot = (dx / d) * aimX + (dy / d) * aimY;
    if (dot < arcCos) continue;
    damageEnemy(e, TUNING.meleeDamage, dx / d, dy / d, MELEE.knockback, state);
  }
}
