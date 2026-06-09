import { describe, expect, it } from 'vitest';
import { computeFrameStats, PerfMeter } from '../perfMeter';

describe('computeFrameStats — frame-time distribution', () => {
  it('returns zeros for an empty window', () => {
    expect(computeFrameStats([])).toEqual({ avgFps: 0, worstMs: 0, p1LowFps: 0 });
  });

  it('a steady 60fps stream reads 60 avg / 60 1%-low / ~16.67ms worst', () => {
    const s = computeFrameStats(Array.from({ length: 240 }, () => 1000 / 60));
    expect(s.avgFps).toBeCloseTo(60, 6);
    expect(s.p1LowFps).toBeCloseTo(60, 6);
    expect(s.worstMs).toBeCloseTo(1000 / 60, 6);
  });

  it('worstMs is the single longest frame', () => {
    const s = computeFrameStats([16, 16, 50, 16, 16]);
    expect(s.worstMs).toBe(50);
  });

  it('1%-low is the MEAN of the worst 1% (here 1 of 100 frames) — a hitch tanks it', () => {
    // 99 perfect 16.67ms frames + one 100ms hitch. avg stays high; 1%-low = the
    // worst frame alone (ceil(100/100)=1) -> 10fps, the metric the average hides.
    const frames = Array.from({ length: 99 }, () => 1000 / 60);
    frames.push(100);
    const s = computeFrameStats(frames);
    expect(s.p1LowFps).toBeCloseTo(1000 / 100, 6); // 10fps from the 100ms frame
    expect(s.avgFps).toBeGreaterThan(50); // average still looks "fine"
  });

  it('worst 1% averages MULTIPLE frames when the window is large enough', () => {
    // 200 frames -> ceil(200/100) = 2 in the worst-1% slice: mean of 40 and 60 = 50ms.
    const frames = Array.from({ length: 198 }, () => 1000 / 60);
    frames.push(40, 60);
    const s = computeFrameStats(frames);
    expect(s.p1LowFps).toBeCloseTo(1000 / 50, 6); // mean(40,60)=50ms -> 20fps
  });
});

describe('PerfMeter — bounded ring buffer + interval recompute', () => {
  it('caches stats and only recomputes after recalcMs elapses', () => {
    const m = new PerfMeter(120, 500);
    for (let i = 0; i < 120; i++) m.push(1000 / 60);
    const first = m.sample(1000); // first sample computes (lastCalc = -Infinity)
    expect(first.avgFps).toBeCloseTo(60, 4);

    // Push slow frames, but sample again BEFORE the interval -> stale (cached) stats.
    for (let i = 0; i < 120; i++) m.push(1000 / 10);
    expect(m.sample(1200).avgFps).toBeCloseTo(60, 4); // 200ms < 500ms recalcMs -> cached

    // After the interval, it recomputes from the now-slow window.
    expect(m.sample(1700).avgFps).toBeCloseTo(10, 4);
  });

  it('the ring buffer is bounded — only the last `window` frames count', () => {
    const m = new PerfMeter(60, 0); // recalcMs 0 -> always recompute
    for (let i = 0; i < 60; i++) m.push(1000 / 30); // fill with 30fps frames
    expect(m.sample(1).avgFps).toBeCloseTo(30, 4);
    for (let i = 0; i < 60; i++) m.push(1000 / 120); // overwrite all with 120fps
    expect(m.sample(2).avgFps).toBeCloseTo(120, 4); // old 30fps frames evicted
  });
});
