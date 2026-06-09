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
