import { describe, expect, it } from 'vitest';
import { depthCue, depthFadeAction, depthTarget } from '../depthFade';

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

describe('depth surface routing — depthTarget (fix: floor-2+ collision)', () => {
  it('FLOOR 1 → the HUD-band depth (uncompacted, clear)', () => {
    expect(depthTarget(1)).toBe('hud');
  });

  it('FLOOR 2+ → the center-screen announce (HUD band is compacted → would collide)', () => {
    expect(depthTarget(2)).toBe('announce');
    expect(depthTarget(7)).toBe('announce');
  });
});

describe('combined per-floor depth cue — depthCue (action + routed surface)', () => {
  it('FLOOR 1 arrival → SHOW on the HUD band (the unchanged floor-1 behaviour)', () => {
    expect(depthCue(true, 1, -1, false)).toEqual({ action: 'show', target: 'hud' });
  });

  it('FLOOR 1 combat entry → FADE the HUD band', () => {
    expect(depthCue(false, 1, 0, false)).toEqual({ action: 'fade', target: 'hud' });
  });

  it('FLOOR 2 arrival → SHOW the center announce (NOT the colliding HUD band)', () => {
    expect(depthCue(true, 2, -1, false)).toEqual({ action: 'show', target: 'announce' });
  });

  it('FLOOR 2 combat entry → FADE the center announce', () => {
    expect(depthCue(false, 2, 0, false)).toEqual({ action: 'fade', target: 'announce' });
  });

  it('settled on a later-floor entry room (no change, pre-combat) → NONE on the announce', () => {
    expect(depthCue(false, 3, -1, false)).toEqual({ action: 'none', target: 'announce' });
  });

  it('the later-floor cycle: descend→show announce, combat→fade announce, then quiet', () => {
    expect(depthCue(true, 2, -1, false)).toEqual({ action: 'show', target: 'announce' }); // descend to 2
    expect(depthCue(false, 2, -1, false)).toEqual({ action: 'none', target: 'announce' }); // settled
    expect(depthCue(false, 2, 0, false)).toEqual({ action: 'fade', target: 'announce' }); // into combat
    expect(depthCue(false, 2, 0, true)).toEqual({ action: 'none', target: 'announce' }); // stays faded
  });
});
