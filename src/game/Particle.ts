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
  }));
}

/** Rotates each burst so successive bursts don't overlap identically. */
let burstSeed = 0;

/** Emit up to `count` particles in a radial fan from (x, y). Reuses inactive
 *  slots; never grows the pool. */
export function spawnParticles(pool: Particle[], x: number, y: number, count: number): void {
  const base = burstSeed * 0.61803; // golden-ish offset, deterministic
  burstSeed++;
  let spawned = 0;
  for (let i = 0; i < pool.length && spawned < count; i++) {
    const p = pool[i];
    if (p.active) continue;
    const ang = base + (spawned / count) * Math.PI * 2;
    // Deterministic speed variation in [0.6, 1.0] * PARTICLE.speed.
    const spd = PARTICLE.speed * (0.6 + 0.4 * ((spawned % 4) / 3));
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(ang) * spd;
    p.vy = Math.sin(ang) * spd;
    p.life = PARTICLE.lifetime;
    p.maxLife = PARTICLE.lifetime;
    spawned++;
  }
}

/** Advance particles by one fixed step. */
export function updateParticles(pool: Particle[], dt: number): void {
  for (const p of pool) {
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.9; // per-step drag (sim runs at fixed SIM_DT)
    p.vy *= 0.9;
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
