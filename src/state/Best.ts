/**
 * Personal-best score, backed by localStorage. The FIRST persistent (between-run)
 * state in the game. Every access is wrapped in try/catch (Safari Private Mode
 * throws on writes and can throw on reads), so a storage failure degrades to an
 * in-memory zero best — the run loop must NEVER break because storage is gone.
 *
 * DESIGN BOUNDARY: this is DISPLAY ONLY. Nothing in the pure sim (src/game/) may
 * import or read it; it grants zero gameplay advantage. Real between-run
 * progression is Phase 10 — keep the within-run/between-run line bright here.
 */

const STORAGE_KEY = 'rogue-descent:best';

export interface BestScore {
  /** Deepest floor reached across all runs. */
  depth: number;
}

export const NO_BEST: BestScore = { depth: 0 };

/** Pure: the better of an existing best and a run's depth. No I/O — testable. */
export function betterBest(prev: BestScore, depth: number): BestScore {
  return depth > prev.depth ? { depth } : prev;
}

/** Load the stored best, or a zero best if absent/unavailable. Never throws. */
export function loadBest(): BestScore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...NO_BEST };
    const parsed = JSON.parse(raw) as Partial<BestScore>;
    return { depth: typeof parsed.depth === 'number' ? parsed.depth : 0 };
  } catch {
    return { ...NO_BEST };
  }
}

/**
 * Record a finished run's depth: persist it only if it beats the stored best.
 * Returns the (possibly updated) best for immediate display. Never throws — a
 * storage failure just means the best isn't persisted (this-run stats still show).
 */
export function recordRunDepth(depth: number): BestScore {
  const next = betterBest(loadBest(), depth);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private-mode / quota failure: keep running with the in-memory best.
  }
  return next;
}
