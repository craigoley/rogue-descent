import { describe, expect, it } from 'vitest';
import { depthFadeAction, shouldFadeTitle } from '../depthFade';

describe('per-floor depth show/fade decision — depthFadeAction (keyed on leaving the entry room)', () => {
  it('frame-1 / spawn (depthChanged, still in entry room, not yet faded) → SHOW', () => {
    // prevDepth NaN vs depth N reads as a "change"; leftEntryRoom false (room 0), not faded.
    expect(depthFadeAction(true, false, false)).toBe('show');
  });

  it('steady in the entry room, pre-movement (no change, not left) → NONE', () => {
    expect(depthFadeAction(false, false, false)).toBe('none');
  });

  it('left the entry room (pre-combat), not yet faded → FADE', () => {
    expect(depthFadeAction(false, true, false)).toBe('fade');
  });

  it('already faded this floor, still outside the entry room → NONE (latch holds, fades once)', () => {
    expect(depthFadeAction(false, true, true)).toBe('none');
  });

  it('ARRIVAL takes priority: a new floor re-shows even after the prior floor faded', () => {
    // Descend → depth changes → re-show, regardless of the carried depthFaded latch.
    expect(depthFadeAction(true, false, true)).toBe('show');
  });

  it('arrival wins over fade if both ever coincide (player spawns in room 0, so it cannot, but be safe)', () => {
    expect(depthFadeAction(true, true, false)).toBe('show');
  });

  it('the per-floor cycle: arrive→show, settle→none, leave→fade, faded→none', () => {
    expect(depthFadeAction(true, false, false)).toBe('show'); // arrive in the entry room
    expect(depthFadeAction(false, false, false)).toBe('none'); // settled, pre-movement
    expect(depthFadeAction(false, true, false)).toBe('fade'); // stepped out of the entry room
    expect(depthFadeAction(false, true, true)).toBe('none'); // stays faded for the floor
  });
});

describe('title fade decision — shouldFadeTitle (one-time game-start flourish)', () => {
  it('does NOT fade while still in the entry room (spawn)', () => {
    expect(shouldFadeTitle(false, false)).toBe(false);
  });

  it('FADES the first time the player leaves the entry room', () => {
    expect(shouldFadeTitle(true, false)).toBe(true);
  });

  it('never fades again once faded (one-time — never reverts)', () => {
    expect(shouldFadeTitle(true, true)).toBe(false);
  });

  it('stays put if somehow back in the entry room after fading (latch holds)', () => {
    expect(shouldFadeTitle(false, true)).toBe(false);
  });
});
