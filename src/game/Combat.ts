/**
 * Shared pure combat machinery: aim resolution and the damage application that
 * BOTH attacks and the enemy feed into. Kept in one place so melee, ranged and
 * enemy strikes apply identical feedback (flash, knockback, particles, hit-stop,
 * shake). ZERO three/DOM.
 *
 * Runtime imports are leaf-only (Particle + constants), so this never forms an
 * import cycle with Enemy/Projectile/GameState (which import it).
 */

import { BOSS, BURN_LEVELS, CHAIN_LEVELS, CRIT, CRIT_LEVELS, DASH_STRIKE, DEFENSE, ENEMY_COMMON, ENEMY_DEATH_TINT, ENEMY_TYPES, FREEZE_LEVELS, KNOCKBACK_LEVELS, LIFESTEAL_LEVELS, MELEE, MELEE_LEVELS, PARTICLE, PLAYER_COMBAT, SHAKE, TUNING } from '../utils/constants';
import { spawnParticles } from './Particle';
import { spawnChainArc } from './ChainArc';
import { isoRotate, type InputIntent } from './Input';
import type { Enemy } from './Enemy';
import { playerMaxHealth, type PlayerState } from './Player';
import type { GameState } from './GameState';
import type { Vec2 } from '../utils/math';

/** The KIND of a damageEnemy call — the synergy arc's hit taxonomy (replaces the old
 *  isDirect boolean, which couldn't express chain's "ignite + count as a kill, but do
 *  NOT lifesteal or re-chain" semantics):
 *   - 'direct' — a player hit (melee / ranged / dash-strike): full feedback, lifesteal,
 *     burn-ignite, AND it can TRIGGER a chain.
 *   - 'chain'  — a CHAIN arc (PR3): feedback + burn-ignite + the death path, but NO
 *     lifesteal and — crucially — it can NEVER trigger another chain (only 'direct'
 *     does), so the no-cascade bound is enforced by the type, not a runtime guard.
 *   - 'tick'   — a burn DoT tick (PR2): damage + death path ONLY; no feedback, no
 *     lifesteal, no ignite (so it can't re-ignite itself), and it bypasses the boss
 *     armor check (the ignition was already validated by a weak-side direct hit). */
export type HitKind = 'direct' | 'chain' | 'tick';

/** Module scratch for the chain dedupe Set — chains complete SYNCHRONOUSLY and never
 *  nest ('chain' hits don't re-chain), so one reusable Set avoids per-hit allocation
 *  (mirrors the _aim-style scratch pattern). Cleared at the start of every chainFrom. */
const _chainSet = new Set<Enemy>();

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
 *  `kind` (default 'direct') is the hit taxonomy — see HitKind. */
export function damageEnemy(
  enemy: Enemy,
  amount: number,
  kbDirX: number,
  kbDirY: number,
  kbForce: number,
  state: GameState,
  kind: HitKind = 'direct',
): boolean {
  // GIMMICK #1 (Phase 8): a boss only takes damage from its VULNERABLE side. A
  // hit from the armored side is BLOCKED — no health loss (blockedDamageMult 0),
  // no knockback, no hit-stop; it flashes the SHIELD tell instead. kbDir is the
  // attacker -> enemy direction, so boss -> attacker is its negation; the hit is
  // vulnerable when that lies within half the weak arc. Inlined (not imported
  // from Boss) to avoid a Combat<->Boss import cycle; mirrors bossVulnerable().
  // GIMMICK #3: while staggerTimer > 0 the shield is DOWN — skip this block so a
  // successful interrupt lets hits land from ANY angle (the free-hit reward).
  // Burn ticks (kind='tick') bypass the armor check: the ignition was already
  // validated by a weak-side direct hit, and the zero kbDir would always read as
  // "armored side" (dot=0 < cos(arc/2)), blocking every tick for zero damage.
  if (kind !== 'tick' && enemy.type === 'boss' && state.boss && state.boss.staggerTimer <= 0) {
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
        spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.deathCount, ENEMY_DEATH_TINT[enemy.type]);
      }
      return false; // BLOCKED — armored side (not a weak-side hit)
    }
  }
  // SYNERGY ARC PR4 — CRIT (the multiplier glue): a DIRECT hit has a per-level chance
  // to deal ×multiplier. Rolled HERE (after the armor return, before health is dealt)
  // so the boosted `dmg` flows into the health subtraction AND lifesteal + chainFrom
  // below — a crit spikes the heal and the whole wildfire base for free. A seeded
  // combatRng draw, ONLY when critLevel > 0 (so default runs / existing tests never
  // draw → byte-identical) and ONLY for 'direct' (arcs + ticks never crit). The
  // combatRng stream is independent of dropRng, so drop sequences are untouched.
  let dmg = amount;
  let crit = false;
  if (kind === 'direct' && state.player.critLevel > 0) {
    if (state.combatRng.next() < CRIT_LEVELS.chance[state.player.critLevel]) {
      crit = true;
      dmg = amount * CRIT_LEVELS.multiplier;
    }
  }
  enemy.health -= dmg;
  // Hit feedback + on-hit EFFECTS. Gated by hit KIND (see HitKind): a burn 'tick'
  // gets NONE of this (it would white-flash over the burn tint, spam particles, and
  // micro-freeze via hit-stop every frame) — only direct + chain hits flash, ignite,
  // etc. A tick only subtracts health + falls through to the shared death path below.
  if (kind !== 'tick') {
    enemy.flashTimer = ENEMY_COMMON.flash;
    // Per-type mass: light enemies (swarmers) get launched farther by the same
    // impulse (chaser/ranged mult = 1, so this is identity for them). Chain arcs pass
    // force 0, so they flash but don't shove.
    const kb = kbForce * ENEMY_TYPES[enemy.type].knockbackMult;
    enemy.kbVx += kbDirX * kb;
    enemy.kbVy += kbDirY * kb;
    // CRIT tell (synergy arc PR4): a bigger spark burst + a stronger/longer hit-stop
    // (the time-dilation "crunch") so a crit READS as a crit, not just more damage.
    // Render-fed-by-sim, like the base feedback. Falls back to the normal hit feel.
    // DIRECTIONAL spray (juice PR-2): fan the sparks AWAY along the knockback
    // vector (the impact side) so the hit reads "struck from the player". White
    // (tint 0) — distinct from the enemy-COLOURED kill burst. Deterministic (dir
    // is the already-computed kbDir; no new RNG). Chain arcs also spray along
    // their arc direction (source → target); only calls with zero dir fall back
    // to the uniform ring.
    spawnParticles(
      state.particles,
      enemy.x,
      enemy.y,
      crit ? PARTICLE.critCount : PARTICLE.hitCount,
      0,
      kbDirX,
      kbDirY,
      PARTICLE.hitSpread,
    );
    const stop = crit ? CRIT.hitstop : TUNING.hitstop;
    if (stop > state.hitstopTimer) state.hitstopTimer = stop;
    // CRIT FLARE (juice PR-3): a brief bright bloom-flaring flash so the crit is
    // SEEN, not just felt. Cosmetic timer set ONLY on a crit (the seeded roll above)
    // → crit-exclusive + byte-deterministic; the renderer reads it. Adds to the
    // crunch (bigger burst + longer hit-stop), doesn't replace it.
    if (crit) enemy.critFlashTimer = CRIT.flashDuration;
    // SYNERGY ARC PR1 — LIFESTEAL: heal a fraction of damage dealt (the crit-boosted
    // `dmg` → a crit heals bigger, free). DIRECT hits ONLY — a chain arc must NOT
    // lifesteal per-jump (bound E). Auto-multiplies with melee/multishot/pierce/dash.
    if (kind === 'direct' && dmg > 0) {
      const frac = LIFESTEAL_LEVELS.frac[state.player.lifestealLevel];
      const maxHp = playerMaxHealth(state.player); // MAX-HP track raises the lifesteal ceiling too
      if (frac > 0 && state.player.health < maxHp) {
        const heal = Math.min(dmg * frac, LIFESTEAL_LEVELS.maxPerHit);
        state.player.health = Math.min(maxHp, state.player.health + heal);
      }
    }
    // SYNERGY ARC PR2 — BURN: IGNITE (refresh-not-stack). Direct AND chain hits ignite
    // → chain × burn = WILDFIRE (each arc carries fire to the pack). The 'tick' kind is
    // excluded above so a burn tick can't re-ignite itself.
    if (state.player.burnLevel > 0) {
      enemy.burnTimer = BURN_LEVELS.duration;
      enemy.burnDps = BURN_LEVELS.dps[state.player.burnLevel];
      // META PR2 — WILDFIRE attribution: record whether THIS ignition was SPREAD by a
      // chain arc (kind==='chain') or lit directly (kind==='direct'). A later burn-TICK
      // kill on a chain-ignited enemy is a wildfire kill (the death choke below).
      enemy.ignitedByChain = kind === 'chain';
    }
    // META PR1 — FREEZE: a DIRECT hit SLOWS the enemy's movement (refresh-not-stack).
    // DIRECT only (like lifesteal) — not chain/tick — so it stays a positioning tool,
    // not a spreadable lockdown. Distinct from stun: the enemy still ACTS (the slow is
    // applied to its movement in updateEnemies, not an AI freeze).
    if (kind === 'direct' && state.player.freezeLevel > 0) {
      enemy.slowTimer = FREEZE_LEVELS.duration;
      enemy.slowFactor = FREEZE_LEVELS.slowMult[state.player.freezeLevel];
    }
    // SYNERGY ARC PR3 — CHAIN: a DIRECT hit arcs to nearby enemies. Triggered ONLY by
    // 'direct' (a 'chain' arc can never re-trigger → the no-cascade bound is enforced
    // by the type). One hook here = melee / ranged / dash-strike all chain for free.
    if (kind === 'direct' && state.player.chainLevel > 0) {
      chainFrom(state, enemy, dmg, state.player.chainLevel); // crit-boosted base → bigger wildfire
    }
  }
  if (enemy.health <= 0) {
    enemy.active = false;
    spawnParticles(state.particles, enemy.x, enemy.y, PARTICLE.deathCount, ENEMY_DEATH_TINT[enemy.type]);
    // META PR2 — WILDFIRE counter (Def C): a burn-TICK kill on a CHAIN-spread enemy =
    // the fire the chain carried finished it. The single, exhaustive death choke (direct/
    // chain/tick all reach here), so this counts every wildfire kill exactly once. A
    // direct/chain killing blow, or a tick kill on a directly-lit enemy, does NOT count.
    if (kind === 'tick' && enemy.ignitedByChain) state.run.wildfireKills += 1;
  }
  return true; // LANDED (for a boss: a weak-side hit — the interrupt signal source)
}

/**
 * SYNERGY ARC PR3 — CHAIN. From a just-hit enemy, ARC to up to maxJumps[level] nearby
 * enemies, dealing falloff-reduced damage to each via damageEnemy('chain') — so each
 * arc inherits burn-ignite (wildfire) + the death/kill/drop path, but NOT lifesteal
 * and NOT another chain (the 'chain' kind can't re-trigger this). BOUNDS, all here:
 *   - JUMP CAP: the loop runs at most maxJumps[level] times (never unbounded).
 *   - DEDUPE: a Set seeded with the origin → never re-hits a chained enemy (no A→B→A).
 *   - FALLOFF: damage compounds ×falloff each jump → spread/utility, not a nuke.
 * Deterministic: nearest-search is pure geometry over the ≤8 pool, ties broken by the
 * LOWER pool index (strict-less replace), no RNG. Uses a module-scratch Set (chains
 * never nest) so there's zero per-hit allocation.
 */
function chainFrom(state: GameState, origin: Enemy, baseDamage: number, level: number): void {
  const maxJumps = CHAIN_LEVELS.maxJumps[level];
  if (maxJumps <= 0) return;
  const set = _chainSet;
  set.clear();
  set.add(origin); // the source is never a chain target
  const range2 = CHAIN_LEVELS.range * CHAIN_LEVELS.range;
  let from = origin;
  let dmg = baseDamage;
  for (let j = 0; j < maxJumps; j++) {
    dmg *= CHAIN_LEVELS.falloff;
    // Nearest ACTIVE, un-chained enemy within range. Strict-less replace → on a tie
    // the lower pool index wins (deterministic).
    let next: Enemy | null = null;
    let best = Infinity;
    for (const e of state.enemies) {
      if (!e.active || set.has(e)) continue;
      const dx = e.x - from.x;
      const dy = e.y - from.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= range2 && d2 < best) {
        best = d2;
        next = e;
      }
    }
    if (!next) break; // no target in range — the chain ends
    set.add(next);
    const dx = next.x - from.x;
    const dy = next.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    spawnChainArc(state.chainArcs, from.x, from.y, next.x, next.y); // render tell
    // force 0 — an arc, not a shove; 'chain' inherits burn + death, not lifesteal/re-chain.
    damageEnemy(next, dmg, dx / len, dy / len, 0, state, 'chain');
    from = next;
  }
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
  // DAMAGE-REDUCTION defensive track: cut the incoming hit by drPerLevel × level (linear,
  // max 24% at tier III). `amount` already carries Heat's spawn-time damage scaling, so this
  // mitigates the Heat-boosted hit — the natural order, no special-casing.
  player.health -= amount * (1 - DEFENSE.drPerLevel * player.drLevel);
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
