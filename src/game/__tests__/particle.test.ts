import { describe, expect, it } from 'vitest';
import { createParticlePool, spawnParticles, updateParticles } from '../Particle';
import { PARTICLE } from '../../utils/constants';

describe('Particle tint (juice PR-1 kill-feel) — a colour tag, never a sim input', () => {
  it('defaults to tint 0 (the white spark) when no tint is passed', () => {
    const pool = createParticlePool();
    spawnParticles(pool, 1, 2, 5);
    const live = pool.filter((p) => p.active);
    expect(live.length).toBe(5);
    expect(live.every((p) => p.tint === 0)).toBe(true);
  });

  it('stamps the given tint on every particle of the burst', () => {
    const pool = createParticlePool();
    spawnParticles(pool, 0, 0, 6, 0xff8095);
    const live = pool.filter((p) => p.active);
    expect(live.length).toBe(6);
    expect(live.every((p) => p.tint === 0xff8095)).toBe(true);
  });

  it('tint does not change the count / life / speed envelope (it is orthogonal to the spread)', () => {
    const pool = createParticlePool();
    spawnParticles(pool, 5, 5, PARTICLE.deathCount, 0x123456);
    const live = pool.filter((p) => p.active);
    expect(live.length).toBe(PARTICLE.deathCount);
    for (const p of live) {
      expect(p.life).toBe(PARTICLE.lifetime);
      expect(p.maxLife).toBe(PARTICLE.lifetime);
      // Speed sits in the documented [0.6, 1.0] × speed band regardless of tint.
      const spd = Math.hypot(p.vx, p.vy);
      expect(spd).toBeGreaterThanOrEqual(PARTICLE.speed * 0.6 - 1e-9);
      expect(spd).toBeLessThanOrEqual(PARTICLE.speed + 1e-9);
    }
  });

  it('a directional burst sprays inside the impact cone, centred on the hit vector', () => {
    const pool = createParticlePool();
    const dirX = 1;
    const dirY = 0; // impact along +x
    const spread = PARTICLE.hitSpread;
    spawnParticles(pool, 0, 0, PARTICLE.hitCount, 0, dirX, dirY, spread);
    const live = pool.filter((p) => p.active);
    expect(live.length).toBe(PARTICLE.hitCount);
    const dirAng = Math.atan2(dirY, dirX);
    // Every particle's heading is within (half-cone + the one-step jitter) of the dir.
    const tol = spread / 2 + spread / PARTICLE.hitCount;
    for (const p of live) {
      let d = Math.atan2(p.vy, p.vx) - dirAng;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // wrap to [-π, π]
      expect(Math.abs(d)).toBeLessThanOrEqual(tol + 1e-9);
    }
  });

  it('the directional spray is BIASED along the hit vector (mean velocity aligns with dir), unlike the uniform ring', () => {
    // Directional: the average velocity points roughly along the impact dir.
    const dir = createParticlePool();
    const dx = 0.6;
    const dy = -0.8; // normalized impact vector
    spawnParticles(dir, 0, 0, PARTICLE.hitCount, 0, dx, dy, PARTICLE.hitSpread);
    const dl = dir.filter((p) => p.active);
    const mvx = dl.reduce((s, p) => s + p.vx, 0) / dl.length;
    const mvy = dl.reduce((s, p) => s + p.vy, 0) / dl.length;
    const mlen = Math.hypot(mvx, mvy);
    expect(mlen).toBeGreaterThan(0.3 * PARTICLE.speed); // a real net bias, not ~0
    // ...and that bias points along the impact dir (dot of unit-mean with dir > 0.8).
    expect((mvx / mlen) * dx + (mvy / mlen) * dy).toBeGreaterThan(0.8);

    // Uniform ring (no dir): the mean velocity ~cancels to near zero (no bias).
    const ring = createParticlePool();
    spawnParticles(ring, 0, 0, PARTICLE.hitCount);
    const rl = ring.filter((p) => p.active);
    const rmx = rl.reduce((s, p) => s + p.vx, 0) / rl.length;
    const rmy = rl.reduce((s, p) => s + p.vy, 0) / rl.length;
    expect(Math.hypot(rmx, rmy)).toBeLessThan(0.3 * PARTICLE.speed);
  });

  it('a tinted particle ages + dies exactly like an untinted one (tint survives, drives nothing)', () => {
    const pool = createParticlePool();
    spawnParticles(pool, 0, 0, 1, 0x00ff88);
    const p = pool.find((q) => q.active)!;
    const steps = Math.ceil(PARTICLE.lifetime / (1 / 60)) + 1;
    for (let i = 0; i < steps; i++) updateParticles(pool, 1 / 60);
    expect(p.active).toBe(false); // expired on schedule
    expect(p.tint).toBe(0x00ff88); // the tag is untouched by the update step
  });
});
