/**
 * Pooled hit-spark particles — the cheap juice that sells contact. Pure: ZERO
 * three/DOM. FIXED-SIZE pool (POOL.particles); spawning past capacity simply
 * drops the extra sparks rather than growing the array, so nothing allocates
 * after construction.
 *
 * The spread is DETERMINISTIC (a per-burst angle offset from a counter, not
 * Math.random) so the sim stays reproducible and unit-testable.
 */

import { PARTICLE, POOL } from '../utils/constants';

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life, seconds. */
  life: number;
  /** Life at spawn, seconds (renderer fades by life / maxLife). */
  maxLife: number;
  /** Burst colour tag (0xRRGGBB) — 0 = the default white spark; a death burst
   *  carries the dead enemy's bright body hue (see ENEMY_DEATH_TINT). Pure data
   *  (a plain number); the RENDERER maps it to a material. Never affects the sim. */
  tint: number;
}

export function createParticlePool(): Particle[] {
  return Array.from({ length: POOL.particles }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    tint: 0,
  }));
}

/** Rotates each burst so successive bursts don't overlap identically. */
let burstSeed = 0;

/** Emit up to `count` particles from (x, y). Reuses inactive slots; never grows
 *  the pool. `tint` (default 0 = white spark) is a pure colour tag the renderer
 *  maps to a material. `dir`+`spread` (default 0 = the uniform radial RING, the
 *  original behaviour) bias the burst into a CONE centred on (dirX, dirY) with the
 *  given angular `spread` — a DIRECTIONAL impact spray (juice PR-2). Everything is
 *  DETERMINISTIC: angles derive from the per-burst `burstSeed` + the passed dir, no
 *  RNG — same seed+dir → same particles; an untinted, non-directional call is
 *  byte-identical to before. */
export function spawnParticles(
  pool: Particle[],
  x: number,
  y: number,
  count: number,
  tint = 0,
  dirX = 0,
  dirY = 0,
  spread = 0,
): void {
  const base = burstSeed * 0.61803; // golden-ish offset, deterministic
  burstSeed++;
  const directional = spread > 0 && (dirX !== 0 || dirY !== 0);
  const dirAng = directional ? Math.atan2(dirY, dirX) : 0;
  let spawned = 0;
  for (let i = 0; i < pool.length && spawned < count; i++) {
    const p = pool[i];
    if (p.active) continue;
    let ang: number;
    if (directional) {
      // Fan evenly across the impact cone (centred on the hit direction), with a
      // small deterministic jitter so repeated identical hits don't look stamped.
      const frac = count > 1 ? spawned / (count - 1) : 0.5; // 0..1 across the cone
      ang = dirAng + (frac - 0.5) * spread + ((base % 1) - 0.5) * (spread / count);
    } else {
      ang = base + (spawned / count) * Math.PI * 2; // uniform ring (unchanged default)
    }
    // Deterministic speed variation in [0.6, 1.0] * PARTICLE.speed.
    const spd = PARTICLE.speed * (0.6 + 0.4 * ((spawned % 4) / 3));
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(ang) * spd;
    p.vy = Math.sin(ang) * spd;
    p.life = PARTICLE.lifetime;
    p.maxLife = PARTICLE.lifetime;
    p.tint = tint;
    spawned++;
  }
}

/** Advance particles by one fixed step. */
export function updateParticles(pool: Particle[], dt: number): void {
  for (const p of pool) {
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= PARTICLE.drag;
    p.vy *= PARTICLE.drag;
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
}

/** Count of live particles — for tests (pool-reuse guard). */
export function activeParticleCount(pool: Particle[]): number {
  let n = 0;
  for (const p of pool) if (p.active) n++;
  return n;
}
