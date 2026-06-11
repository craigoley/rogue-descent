/**
 * META-PROGRESSION state, backed by localStorage — the between-run UNLOCK set (Phase
 * 10 / meta arc). Extends the exact pattern Best.ts established: an app/state-layer
 * module, every access wrapped in try/catch (Safari Private Mode throws), degrading to
 * the BASE default so the run loop NEVER breaks on storage failure.
 *
 * DESIGN BOUNDARY (the crux): nothing in the pure sim (src/game/) imports this. The
 * app layer (main.ts) reads it, builds a RunConfig (the unlocked-content set), and
 * passes that INTO the run as config — src/game/ receives config as a pure input and
 * never touches storage. A run stays deterministic given (seed, config).
 *
 * Unlike Best (display-only, zero gameplay effect), meta UNLOCKS CONTENT — but it
 * still only crosses into the sim as config DATA, never as a storage read. The shape
 * is EXTENSIBLE across all three meta layers from day one (runStart = L2 directional
 * choice; heat = L3 challenge) so later layers add no migration.
 */

import { HEAT } from '../utils/constants';
import { NO_HEAT, normalizeHeat, type HeatConfig } from '../game/Heat';

const STORAGE_KEY = 'rogue-descent:meta';
const VERSION = 1;

export interface MetaState {
  version: number;
  /** Layer 1 — unlocked content ids (e.g. 'freeze'). Drives the run's available pool. */
  unlocked: string[];
  /** Milestone progress — the source the unlock rules read (extensible). */
  stats: {
    /** Deepest floor reached across all runs. */
    deepestDepth: number;
    /** Total bosses defeated across all runs. */
    bossKills: number;
    /** META PR2 — cumulative WILDFIRE kills across all runs (burn-tick kills on
     *  chain-spread enemies). The first SKILL-attributed milestone source: sustained
     *  chain×burn play unlocks the fire-rate track. */
    wildfireKills: number;
    /** META L3 — the HIGHEST Heat total at which the player has WON (reached the
     *  win-depth W). The reward-stat Heat unlocks dispense against (a Heat win at N
     *  records max(prev, N)); 0 = never won at any Heat. */
    highestHeatWin: number;
  };
  /** Layer 2 — chosen run-start LEAN direction (a powerup-kind id, or null). */
  runStart: string | null;
  /** Layer 3 — chosen HEAT: the per-modifier ranks for the next run (the menu persists
   *  the last pick here). NO_HEAT = no challenge selected. */
  heat: HeatConfig;
}

/** The milestone stat a given unlock tracks (a key of MetaState.stats). */
export type StatKey = keyof MetaState['stats'];

/** One unlockable's DEFINITION — the SINGLE source of truth for both the unlock RULE
 *  (applyRunResult derives from it) AND the display (unlockProgress reads it), so the
 *  two can never drift. Each unlock is power-NEUTRAL (variety, never raw power) and
 *  flows from PLAYING — no currency, no grind. All thresholds by-feel. */
export interface UnlockDef {
  /** The content id (matches RunConfig.unlocked + the sim's LOCKABLE ids). */
  id: string;
  /** Player-facing name. */
  label: string;
  /** What it IS — shown when unlocked, and as a teaser while locked (not a spoiler). */
  description: string;
  /** The cumulative stat this milestone watches. */
  statKey: StatKey;
  /** Threshold on that stat to unlock (met when stat >= target). */
  target: number;
  /** Binary milestone (done / not-done, no count) vs a counted progression. */
  binary: boolean;
  /** The milestone phrasing; the surface appends live progress for non-binary ones. */
  hint: string;
}

/** The unlock CATALOG — the one place "what unlocks what, at what threshold" lives.
 *  Spans all three Layer-1 dimensions: EFFECT (freeze), ENEMY (armored-chaser),
 *  TRACK (fireRate). Order = display order. */
export const UNLOCKS: readonly UnlockDef[] = [
  {
    id: 'freeze',
    label: 'Freeze',
    description: 'Your direct hits slow the enemies they strike.',
    statKey: 'bossKills',
    target: 1,
    binary: true,
    hint: 'Beat the boss',
  },
  {
    id: 'armored-chaser',
    label: 'Armored Chaser',
    description: 'A tougher, plated chaser variant joins the deeper floors.',
    statKey: 'deepestDepth',
    target: 3,
    binary: false,
    hint: 'Reach depth 3',
  },
  {
    id: 'fireRate',
    label: 'Fire Rate',
    description: 'A new upgrade track that speeds up your ranged fire.',
    statKey: 'wildfireKills',
    target: 30,
    binary: false,
    hint: 'Land 30 wildfire kills (chain-spread burn)',
  },
  // META L3 — the Heat REWARD: an ALTERNATE path to the SAME fireRate content, proving
  // the L3→L1 loop (crank Heat → earn variety). A second row for the same id is fine —
  // applyRunResult's Set dedupes the unlock, and the surface shows the two routes.
  {
    id: 'fireRate',
    label: 'Fire Rate',
    description: 'A new upgrade track that speeds up your ranged fire.',
    statKey: 'highestHeatWin',
    target: HEAT.fireRateRewardHeat,
    binary: false,
    hint: `Or win at Heat ${HEAT.fireRateRewardHeat}+`,
  },
];

/** A clean-slate meta: nothing unlocked, zeroed stats. The graceful fallback for an
 *  absent/corrupt/Safari-private save — the game is fully playable from this. */
export function defaultMeta(): MetaState {
  return {
    version: VERSION,
    unlocked: [],
    stats: { deepestDepth: 0, bossKills: 0, wildfireKills: 0, highestHeatWin: 0 },
    runStart: null,
    heat: { ...NO_HEAT },
  };
}

/** Layer-1 unlock rules — PURE (run outcome + current meta → updated meta). No I/O, so
 *  it's unit-testable like betterBest. Milestones flow from PLAYING WELL (no grind, no
 *  currency); each unlock is power-NEUTRAL (more variety, never more raw power).
 *
 *  Triggers span all three lockable DIMENSIONS:
 *    - EFFECT  (PR1): defeat the first boss            → 'freeze'
 *    - ENEMY   (PR2): reach depth 3 (cumulative)       → 'armored-chaser'
 *    - TRACK   (PR2): 30 cumulative WILDFIRE kills     → 'fireRate' (skill-attributed)
 *  Each unlock is power-NEUTRAL (more variety, never more raw power). Pure (run outcome +
 *  meta → meta), so it's unit-testable; persisted unlocked order is sorted/stable. */
export function applyRunResult(
  meta: MetaState,
  outcome: {
    depth: number;
    bossDefeated: boolean;
    wildfireKills: number;
    /** META L3 — this run's Heat TOTAL (Heat.heatTotal of the chosen config). */
    heat: number;
    /** META L3 — did this run reach the win-depth W (deepestDepth >= HEAT.unlockDepth)? */
    reachedWinDepth: boolean;
  },
): MetaState {
  const stats = {
    deepestDepth: Math.max(meta.stats.deepestDepth, outcome.depth),
    bossKills: meta.stats.bossKills + (outcome.bossDefeated ? 1 : 0),
    wildfireKills: meta.stats.wildfireKills + outcome.wildfireKills,
    // L3: a WIN (reached W) records the Heat it was won at; a non-win records nothing.
    // Monotonic max → the highest Heat ever cleared, the reward stat.
    highestHeatWin: Math.max(meta.stats.highestHeatWin, outcome.reachedWinDepth ? outcome.heat : 0),
  };
  // MILESTONES — DERIVED from the catalog (the single source of truth): an unlock fires
  // once its watched stat meets its target. Idempotent via the Set; stats are monotonic
  // (max / sum), so an unlock never reverts. The surface (unlockProgress) reads the SAME
  // catalog, so display + rule can't drift.
  const unlocked = new Set(meta.unlocked);
  for (const u of UNLOCKS) if (stats[u.statKey] >= u.target) unlocked.add(u.id);
  return {
    version: VERSION,
    unlocked: [...unlocked].sort(), // sorted → stable/deterministic persisted order
    stats,
    runStart: meta.runStart,
    heat: meta.heat,
  };
}

/** META LAYER 3 — does the HEAT menu appear? Only AFTER the FIRST WIN — reaching the
 *  win-depth W (deepestDepth >= HEAT.unlockDepth). Before that the player is still
 *  mastering the base game → no Heat card (the post-win gate, mirroring shouldOfferLean's
 *  suppressed-til-first-unlock). Pure. */
export function shouldOfferHeat(meta: MetaState): boolean {
  return meta.stats.deepestDepth >= HEAT.unlockDepth;
}

/** A display row for the UNLOCKS surface — the unlock's identity + its LIVE progress
 *  toward the milestone, read from a (persisted) meta. PURE; the view renders these.
 *  `current` clamps to `target` so a counted bar never overshoots. `unlocked` is the
 *  persisted truth (meta.unlocked), not a re-derivation. */
export interface UnlockRow {
  id: string;
  label: string;
  description: string;
  hint: string;
  unlocked: boolean;
  current: number;
  target: number;
  binary: boolean;
}

/** Build the surface's rows from a meta: for each catalog entry, its unlocked state +
 *  progress toward the milestone (current/target). Pure — unit-testable like betterBest. */
export function unlockProgress(meta: MetaState): UnlockRow[] {
  const have = new Set(meta.unlocked);
  return UNLOCKS.map((u) => ({
    id: u.id,
    label: u.label,
    description: u.description,
    hint: u.hint,
    unlocked: have.has(u.id),
    current: Math.min(meta.stats[u.statKey], u.target),
    target: u.target,
    binary: u.binary,
  }));
}

/** META LAYER 2 — does the RUN-START LEAN ritual appear? Only once the player has
 *  unlocked SOMETHING: a fresh save plays exactly like today (no card), and the lean
 *  ritual ARRIVES as a reward after the first unlock (the Layer 1→2 onboarding tie).
 *  Once shown, its OPTIONS are everything available (base + unlocked kinds) — this gate
 *  is only about the ritual's APPEARANCE. Pure. */
export function shouldOfferLean(meta: MetaState): boolean {
  return meta.unlocked.length > 0;
}

/** The newly-unlocked ids between a before/after meta (for the run-end toast). Pure. */
export function newlyUnlocked(before: MetaState, after: MetaState): string[] {
  const had = new Set(before.unlocked);
  return after.unlocked.filter((id) => !had.has(id));
}

/** Load the stored meta, or the base default if absent/unavailable/corrupt. Never throws. */
export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultMeta();
    const parsed = JSON.parse(raw) as Partial<MetaState>;
    const base = defaultMeta();
    return {
      version: VERSION,
      unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked.filter((x) => typeof x === 'string') : base.unlocked,
      stats: {
        deepestDepth: numberOr(parsed.stats?.deepestDepth, 0),
        bossKills: numberOr(parsed.stats?.bossKills, 0),
        wildfireKills: numberOr(parsed.stats?.wildfireKills, 0),
        highestHeatWin: numberOr(parsed.stats?.highestHeatWin, 0),
      },
      runStart: typeof parsed.runStart === 'string' ? parsed.runStart : null,
      // L3: heat evolved from number → HeatConfig. normalizeHeat sanitizes any shape
      // (an old stored `heat: 0`, a partial, or a corrupt object) to valid ranks → no
      // migration needed; an absent/invalid heat falls back to NO_HEAT.
      heat: normalizeHeat(parsed.heat as Partial<HeatConfig> | undefined),
    };
  } catch {
    return defaultMeta();
  }
}

/** Persist meta. Never throws — a storage failure just means it isn't saved. */
export function saveMeta(meta: MetaState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Private-mode / quota failure: keep running with the in-memory meta.
  }
}

/** Reset meta progress to a clean slate (a settings "Reset progress" action). */
export function resetMeta(): MetaState {
  const fresh = defaultMeta();
  saveMeta(fresh);
  return fresh;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
