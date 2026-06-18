import { describe, expect, it } from 'vitest';
import { pickupPopScale, shouldCueWildfire, spawnInScale } from '../feedbackFx';
import { PICKUP_POP, SPAWN } from '../../utils/constants';

describe('spawnInScale (B) — enemy spawn scale-in (ease-out 0→full)', () => {
  it('starts at 0 the instant of spawn (timer full)', () => {
    expect(spawnInScale(SPAWN.scaleInDuration)).toBeCloseTo(0, 5);
  });

  it('reaches full (1) when the timer elapses', () => {
    expect(spawnInScale(0)).toBeCloseTo(1, 5);
  });

  it('is EASE-OUT: most of the size lands early (>50% by the time 30% elapsed)', () => {
    // 30% elapsed → timerRemaining = 0.7 * duration. easeOutQuad(0.3) = 1-0.49 = 0.51.
    const at30pct = spawnInScale(SPAWN.scaleInDuration * 0.7);
    expect(at30pct).toBeGreaterThan(0.5);
  });

  it('is monotonic non-decreasing as the timer counts down', () => {
    let prev = -1;
    for (let r = SPAWN.scaleInDuration; r >= 0; r -= SPAWN.scaleInDuration / 20) {
      const s = spawnInScale(r);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s;
    }
  });

  it('clamps below 0 / above duration to the [0,1] endpoints', () => {
    expect(spawnInScale(SPAWN.scaleInDuration * 2)).toBeCloseTo(0, 5); // before start
    expect(spawnInScale(-1)).toBeCloseTo(1, 5); // past the end
  });
});

describe('pickupPopScale (C) — on-collect pop (up-overshoot then collapse to 0)', () => {
  it('starts at full size (1) on the collect frame', () => {
    expect(pickupPopScale(PICKUP_POP.popDuration)).toBeCloseTo(1, 5);
  });

  it('overshoots above 1 during the up-phase', () => {
    const upPeakTimer = PICKUP_POP.popDuration * (1 - PICKUP_POP.popUpFrac); // end of up-phase
    expect(pickupPopScale(upPeakTimer)).toBeCloseTo(1 + PICKUP_POP.popOvershoot, 5);
  });

  it('collapses to ~0 as the timer ends (absorbed)', () => {
    expect(pickupPopScale(0)).toBeCloseTo(0, 5);
  });
});

describe('shouldCueWildfire (A) — once-per-run discovery cue decision', () => {
  it('fires on the FIRST wildfire kill (0→1, not yet cued)', () => {
    expect(shouldCueWildfire(0, 1, false)).toBe(true);
  });

  it('does NOT fire again once cued (the build keeps triggering wildfire)', () => {
    expect(shouldCueWildfire(1, 2, true)).toBe(false);
    expect(shouldCueWildfire(5, 9, true)).toBe(false);
  });

  it('does NOT fire on a no-change frame (no new kill)', () => {
    expect(shouldCueWildfire(3, 3, false)).toBe(false);
  });

  it('does NOT fire on a run-reset frame (counter drops to 0 → no spurious cue)', () => {
    // New run: wildfireKills resets 0; the caller re-arms `cued` off this same edge.
    expect(shouldCueWildfire(7, 0, true)).toBe(false);
    expect(shouldCueWildfire(7, 0, false)).toBe(false);
  });

  it('re-arms across runs: after reset (cued cleared by caller), the next first kill cues again', () => {
    expect(shouldCueWildfire(0, 1, false)).toBe(true); // run 2's first wildfire kill
  });
});
