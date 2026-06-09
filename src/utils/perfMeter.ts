/**
 * Frame-time distribution meter for the `?debug=1` readout. PURE TypeScript:
 * ZERO three/DOM — it just ingests frame-times and reports stats, so the pieces
 * that matter (the percentile maths) are Node-testable.
 *
 * Why this exists: the lighting arc (rig-tune -> blob-shadows -> bloom) lands on
 * mobile, and bloom hides HITCHES that a smoothed-average FPS reading masks. The
 * meter surfaces avg / worst / 1%-low so a lighting PR can PROVE it didn't tank
 * the phone instead of eyeball-guessing.
 *
 * The meter must not perturb what it measures: `push` is O(1) with no per-frame
 * allocation (a fixed Float64Array ring buffer), and the sort/percentile runs
 * only on an interval (PERF_METER.recalcMs), never per frame. A per-frame sort of
 * the window would itself cost the FPS we're trying to read.
 */

import { PERF_METER } from './constants';

export interface FrameStats {
  /** Average FPS across the window. */
  avgFps: number;
  /** Worst (longest) single frame-time in the window, ms — the hitch. */
  worstMs: number;
  /** 1%-low FPS: the MEAN frame-time of the worst 1% of frames (>= 1 sample),
   *  expressed as FPS. The standard "is it actually smooth" metric that a
   *  smoothed average hides — a few long frames tank it even at 60 avg. */
  p1LowFps: number;
}

const ZERO: FrameStats = { avgFps: 0, worstMs: 0, p1LowFps: 0 };

/**
 * Pure: frame-times (ms) -> {avgFps, worstMs, p1LowFps}. Allocates a sorted copy,
 * so call it on an INTERVAL (see PerfMeter), never per-frame. Empty input -> zeros.
 */
export function computeFrameStats(frameTimesMs: readonly number[]): FrameStats {
  const n = frameTimesMs.length;
  if (n === 0) return ZERO;

  let sum = 0;
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const t = frameTimesMs[i];
    sum += t;
    if (t > worst) worst = t;
  }
  const avgMs = sum / n;

  // 1%-low: mean of the largest ceil(n/100) frame-times (at least one sample).
  const sorted = Array.from(frameTimesMs).sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil(n / 100));
  let lowSum = 0;
  for (let i = n - k; i < n; i++) lowSum += sorted[i];
  const p1LowMs = lowSum / k;

  return {
    avgFps: avgMs > 0 ? 1000 / avgMs : 0,
    worstMs: worst,
    p1LowFps: p1LowMs > 0 ? 1000 / p1LowMs : 0,
  };
}

/**
 * Bounded ring buffer of recent frame-times with stats cached on an interval.
 * Per-frame cost is just `push` (O(1), no alloc); `sample` returns the cached
 * stats and only recomputes once `recalcMs` has elapsed — so the meter never
 * sorts on the hot path. Debug-only consumer.
 */
export class PerfMeter {
  private readonly buf: Float64Array;
  private readonly window: number;
  private readonly recalcMs: number;
  private count = 0;
  private head = 0;
  private lastCalcMs = -Infinity;
  private stats: FrameStats = ZERO;
  /** Reused scratch for the window snapshot — no alloc on the recompute path. */
  private readonly scratch: number[] = [];

  constructor(window: number = PERF_METER.window, recalcMs: number = PERF_METER.recalcMs) {
    this.window = window;
    this.recalcMs = recalcMs;
    this.buf = new Float64Array(window);
  }

  /** Record one frame-time (ms). O(1), no allocation. */
  push(dtMs: number): void {
    this.buf[this.head] = dtMs;
    this.head = (this.head + 1) % this.window;
    if (this.count < this.window) this.count++;
  }

  /**
   * Return the cached frame stats, recomputing them from the window only if at
   * least `recalcMs` has elapsed since the last recompute. `nowMs` is a
   * performance.now()-style timestamp.
   */
  sample(nowMs: number): FrameStats {
    if (this.count > 0 && nowMs - this.lastCalcMs >= this.recalcMs) {
      this.lastCalcMs = nowMs;
      this.scratch.length = this.count;
      for (let i = 0; i < this.count; i++) this.scratch[i] = this.buf[i];
      this.stats = computeFrameStats(this.scratch);
    }
    return this.stats;
  }
}
