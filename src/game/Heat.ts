/**
 * META LAYER 3 — HEAT: player-authored challenge as a pure config input. ZERO three/
 * DOM/storage. The app (src/state/Meta + the HeatCard) builds a HeatConfig (modifier
 * ranks) and threads it in via RunConfig.heat; the pure sim consumes it as data and
 * multiplies it into the EXISTING depth-difficulty values at spawn time.
 *
 * INVARIANTS:
 *  - base (NO_HEAT, all ranks 0) = identity → the sim is BYTE-IDENTICAL to today (the
 *    regression floor).
 *  - deterministic: ranks are static inputs (no RNG, no wall-clock) → same (seed, heat)
 *    → same run.
 *  - power-neutral, INVERTED: every factor scales an ENEMY / RULE value; the player's
 *    stats + tools are never touched.
 */

import { HEAT } from '../utils/constants';

/** Per-modifier RANK selection (0 = off). The one place a run's chosen challenge lives. */
export interface HeatConfig {
  /** Hard Labor — enemy attack damage. */
  hardLabor: number;
  /** Swift Death — enemy move speed. */
  swiftDeath: number;
  /** Thick Skin — enemy max health. */
  thickSkin: number;
  /** Crowd — extra enemies per room. */
  crowd: number;
}

/** No Heat — the base config (all ranks 0). Identity in every factor below. */
export const NO_HEAT: HeatConfig = { hardLabor: 0, swiftDeath: 0, thickSkin: 0, crowd: 0 };

/** One Heat modifier's MENU definition — id (a HeatConfig key), label/blurb, its rank
 *  ceiling, and the Heat points each rank costs. The single source for the HeatCard +
 *  the total; numbers come from the HEAT constants (no magic numbers here). */
export interface HeatModDef {
  id: keyof HeatConfig;
  label: string;
  description: string;
  maxRank: number;
  heatPerRank: number;
}

/** The starter modifier set (L3-PR1) — 4 fair stat/rule tweaks. Order = menu order. */
export const HEAT_MODS: readonly HeatModDef[] = [
  {
    id: 'hardLabor',
    label: 'Hard Labor',
    description: 'Enemies hit harder.',
    maxRank: HEAT.maxRankStat,
    heatPerRank: HEAT.heatPerRankStat,
  },
  {
    id: 'swiftDeath',
    label: 'Swift Death',
    description: 'Enemies move faster.',
    maxRank: HEAT.maxRankStat,
    heatPerRank: HEAT.heatPerRankStat,
  },
  {
    id: 'thickSkin',
    label: 'Thick Skin',
    description: 'Enemies take more punishment.',
    maxRank: HEAT.maxRankStat,
    heatPerRank: HEAT.heatPerRankStat,
  },
  {
    id: 'crowd',
    label: 'Crowd',
    description: 'More enemies per room.',
    maxRank: HEAT.maxRankCrowd,
    heatPerRank: HEAT.heatPerRankCrowd,
  },
];

/** Clamp a rank into [0, maxRank] (defensive — a corrupt save / out-of-range UI). */
function clampRank(rank: number, maxRank: number): number {
  if (!Number.isFinite(rank)) return 0;
  return Math.max(0, Math.min(maxRank, Math.floor(rank)));
}

/** Sanitize a (possibly partial/corrupt) HeatConfig to valid in-range ranks. */
export function normalizeHeat(h: Partial<HeatConfig> | null | undefined): HeatConfig {
  if (!h) return { ...NO_HEAT };
  return {
    hardLabor: clampRank(h.hardLabor ?? 0, HEAT.maxRankStat),
    swiftDeath: clampRank(h.swiftDeath ?? 0, HEAT.maxRankStat),
    thickSkin: clampRank(h.thickSkin ?? 0, HEAT.maxRankStat),
    crowd: clampRank(h.crowd ?? 0, HEAT.maxRankCrowd),
  };
}

/** The Heat TOTAL — the run's challenge number (Σ rank × heatPerRank). The reward stat
 *  (highestHeatWin) records this; the menu displays it. */
export function heatTotal(h: HeatConfig): number {
  let total = 0;
  for (const m of HEAT_MODS) total += h[m.id] * m.heatPerRank;
  return total;
}

/** Per-enemy STAT multipliers from a HeatConfig (applied at spawn, ON TOP of the depth
 *  curve). All 1.0 at NO_HEAT → identity. Enemy-only — never the player. */
export interface HeatStatMults {
  health: number;
  damage: number;
  speed: number;
}
/** Identity multipliers (= heatStatMults(NO_HEAT)) — the spawn default, so a spawn with
 *  no Heat is byte-identical to today. */
export const NO_HEAT_MULTS: HeatStatMults = { health: 1, damage: 1, speed: 1 };
export function heatStatMults(h: HeatConfig): HeatStatMults {
  return {
    health: 1 + h.thickSkin * HEAT.thickSkinPerRank,
    damage: 1 + h.hardLabor * HEAT.hardLaborPerRank,
    speed: 1 + h.swiftDeath * HEAT.swiftDeathPerRank,
  };
}

/** Extra enemies/room from Crowd (added to enemiesPerRoomForDepth; 0 at NO_HEAT). The
 *  caller still clamps the TOTAL to HEAT.maxEnemiesPerRoom + POOL.enemies. */
export function heatExtraEnemies(h: HeatConfig): number {
  return h.crowd * HEAT.crowdPerRank;
}
