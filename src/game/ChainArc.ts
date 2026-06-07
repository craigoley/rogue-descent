/**
 * Pooled CHAIN-arc bolts (synergy arc PR3) — the visual tell for a chain jump: a
 * brief lightning line between two chained enemies. Pure: ZERO three/DOM. FIXED-SIZE
 * pool (POOL.chainArcs); spawning past capacity drops the extra arc rather than
 * growing the array, so nothing allocates after construction.
 *
 * Cosmetic-but-in-sim, exactly like state.particles: the chain loop (Combat.chainFrom)
 * records an arc segment, the renderer (EntityRenderer) draws + fades a line by
 * life/maxLife. Deterministic (a fixed lifetime, no RNG), so it never perturbs the L1
 * fuzz/invariant tests.
 */

import { CHAIN_ARC, POOL } from '../utils/constants';

export interface ChainArc {
  active: boolean;
  /** Segment endpoints in world (x, y). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Remaining life, seconds. */
  life: number;
  /** Life at spawn, seconds (renderer fades by life / maxLife). */
  maxLife: number;
}

export function createChainArcPool(): ChainArc[] {
  return Array.from({ length: POOL.chainArcs }, () => ({
    active: false,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    life: 0,
    maxLife: 0,
  }));
}

/** Record an arc bolt from (x1,y1) to (x2,y2). Reuses an inactive slot; never grows
 *  the pool (a dropped arc is purely cosmetic). */
export function spawnChainArc(pool: ChainArc[], x1: number, y1: number, x2: number, y2: number): void {
  for (const a of pool) {
    if (a.active) continue;
    a.active = true;
    a.x1 = x1;
    a.y1 = y1;
    a.x2 = x2;
    a.y2 = y2;
    a.life = CHAIN_ARC.lifetime;
    a.maxLife = CHAIN_ARC.lifetime;
    return;
  }
}

/** Advance arc bolts by one fixed step (fade out). */
export function updateChainArcs(pool: ChainArc[], dt: number): void {
  for (const a of pool) {
    if (!a.active) continue;
    a.life -= dt;
    if (a.life <= 0) a.active = false;
  }
}

/** Count of live arcs — for tests / pool-reuse guards. */
export function activeChainArcCount(pool: ChainArc[]): number {
  let n = 0;
  for (const a of pool) if (a.active) n++;
  return n;
}
