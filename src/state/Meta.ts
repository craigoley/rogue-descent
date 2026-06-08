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
  };
  /** Layer 2 (later) — chosen run-start direction. Present now, unused → no migration. */
  runStart: string | null;
  /** Layer 3 (later) — chosen challenge/Heat level. Present now, unused. */
  heat: number;
}

/** A clean-slate meta: nothing unlocked, zeroed stats. The graceful fallback for an
 *  absent/corrupt/Safari-private save — the game is fully playable from this. */
export function defaultMeta(): MetaState {
  return { version: VERSION, unlocked: [], stats: { deepestDepth: 0, bossKills: 0 }, runStart: null, heat: 0 };
}

/** Layer-1 unlock rules — PURE (run outcome + current meta → updated meta). No I/O, so
 *  it's unit-testable like betterBest. Milestones flow from PLAYING WELL (no grind, no
 *  currency); each unlock is power-NEUTRAL (more variety, never more raw power).
 *
 *  Triggers (PR1): defeat the first boss → unlock 'freeze'. (More land in PR2; the
 *  effect-attributed ones that need new run-stat counters come later.) Returns the
 *  same object identity-wise only when nothing changed callers can compare/skip-save. */
export function applyRunResult(
  meta: MetaState,
  outcome: { depth: number; bossDefeated: boolean },
): MetaState {
  const unlocked = new Set(meta.unlocked);
  const bossKills = meta.stats.bossKills + (outcome.bossDefeated ? 1 : 0);
  // MILESTONE: beat the boss at least once → FREEZE joins the pool.
  if (bossKills > 0) unlocked.add('freeze');
  return {
    version: VERSION,
    unlocked: [...unlocked].sort(), // sorted → stable/deterministic persisted order
    stats: {
      deepestDepth: Math.max(meta.stats.deepestDepth, outcome.depth),
      bossKills,
    },
    runStart: meta.runStart,
    heat: meta.heat,
  };
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
      },
      runStart: typeof parsed.runStart === 'string' ? parsed.runStart : null,
      heat: numberOr(parsed.heat, 0),
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
