import { describe, expect, it } from 'vitest';
import { depthFadeAction } from '../depthFade';

describe('per-floor depth show/fade decision — depthFadeAction', () => {
  it('frame-1 / spawn (depthChanged, entry room, not yet faded) → SHOW (inert re-show)', () => {
    // prevDepth NaN vs depth 1 reads as a "change"; activeRoom -1, depthFaded false.
    expect(depthFadeAction(true, -1, false)).toBe('show');
  });

  it('steady on the entry room, pre-combat (no change, activeRoom -1) → NONE', () => {
    expect(depthFadeAction(false, -1, false)).toBe('none');
  });

  it('first combat room of the floor (activeRoom >= 0, not yet faded) → FADE', () => {
    expect(depthFadeAction(false, 0, false)).toBe('fade');
    expect(depthFadeAction(false, 3, false)).toBe('fade');
  });

  it('already faded this floor, still in combat → NONE (latch holds, fades once)', () => {
    expect(depthFadeAction(false, 0, true)).toBe('none');
  });

  it('ARRIVAL takes priority: a new floor re-shows even after the prior floor faded', () => {
    // Descend → depth changes → re-show, regardless of the carried depthFaded latch.
    expect(depthFadeAction(true, -1, true)).toBe('show');
  });

  it('arrival wins over fade if both ever coincide (activeRoom resets to -1, so it cannot, but be safe)', () => {
    expect(depthFadeAction(true, 0, false)).toBe('show');
  });

  it('the per-floor cycle: arrive→show, settle→none, combat→fade, faded→none', () => {
    expect(depthFadeAction(true, -1, false)).toBe('show'); // arrive on the entry room
    expect(depthFadeAction(false, -1, false)).toBe('none'); // settled, pre-combat
    expect(depthFadeAction(false, 1, false)).toBe('fade'); // entered first combat room
    expect(depthFadeAction(false, 1, true)).toBe('none'); // stays faded for the floor
  });
});
