/**
 * Input-layer regression coverage for the touch facing freeze (#25, df7fe04).
 *
 * #25 deliberately RETAINS the aim on stick release (the flick-aim-then-tap-melee
 * ergonomics: fire persists toward the last aim for AIM.firePersistMs). But it
 * deleted the only path that ever returned aim to idle, so retained aim lived
 * FOREVER -> aimDirection's aim branch always won -> the movement->facing fallback
 * was unreachable -> facing froze at the last aim.
 *
 * The fix: tickFire zeroes intent.aim the moment the persist window EXPIRES, so
 * aim returns to idle exactly when the persisted burst ends (retained DURING the
 * window, released after it). These tests exercise tickFire directly as a unit
 * (no DOM) by calling it on a minimal `this` — updateRanged/updateFireIndicator
 * are stubbed (they only touch DOM/indicator state, irrelevant here).
 */
import { describe, expect, it } from 'vitest';
import { Controls } from '../Controls';
import { createIntent } from '../../game/Input';

const tickFire = Controls.prototype.tickFire;
// fireEngaged is private; call it through a cast (we're testing real behaviour).
const fireEngaged = (Controls.prototype as unknown as { fireEngaged: (this: unknown) => boolean })
  .fireEngaged;

/** A minimal stand-in for the fields tickFire/fireEngaged read on `this`. */
function ctx(over: Partial<Record<string, unknown>> = {}) {
  return {
    isTouch: true,
    aimTouchId: null as number | null,
    firePersistTimer: 0,
    intent: createIntent(),
    updateRanged(): void {},
    updateFireIndicator(): void {},
    ...over,
  };
}

describe('tickFire — aim returns to idle when the persist window expires', () => {
  it('RETAINS aim while the window is still counting down (fire still engaged)', () => {
    const c = ctx({ aimTouchId: null, firePersistTimer: 0.5 });
    c.intent.aimX = 0.6; // retained last-aim heading
    c.intent.aimY = -0.8;

    tickFire.call(c, 0.3); // 0.5 -> 0.2, still > 0

    expect(c.firePersistTimer).toBeCloseTo(0.2, 9);
    expect(c.intent.aimX).toBe(0.6); // aim held DURING the window (#25 ergonomics)
    expect(c.intent.aimY).toBe(-0.8);
    expect(fireEngaged.call(c)).toBe(true);
  });

  it('ZEROES aim and disengages fire the tick the window hits 0', () => {
    const c = ctx({ aimTouchId: null, firePersistTimer: 0.2 });
    c.intent.aimX = 0.6;
    c.intent.aimY = -0.8;

    tickFire.call(c, 0.3); // 0.2 -> 0 (expires)

    expect(c.firePersistTimer).toBe(0);
    expect(c.intent.aimX).toBe(0); // aim released -> idle -> movement-fallback re-engages
    expect(c.intent.aimY).toBe(0);
    expect(fireEngaged.call(c)).toBe(false);
  });

  it('does NOT zero aim while the thumb is still down (aiming)', () => {
    const c = ctx({ aimTouchId: 1, firePersistTimer: 0 });
    c.intent.aimX = 0.6;
    c.intent.aimY = -0.8;

    tickFire.call(c, 0.3); // thumb engaged -> the release branch is skipped

    expect(c.intent.aimX).toBe(0.6); // aim preserved while actively aiming
    expect(c.intent.aimY).toBe(-0.8);
    expect(fireEngaged.call(c)).toBe(true);
  });

  it('is a no-op on desktop (isTouch false) — retained aim untouched', () => {
    const c = ctx({ isTouch: false, aimTouchId: null, firePersistTimer: 0.2 });
    c.intent.aimX = 0.6;
    c.intent.aimY = -0.8;

    tickFire.call(c, 0.3);

    expect(c.firePersistTimer).toBe(0.2); // untouched: desktop fire is event-driven
    expect(c.intent.aimX).toBe(0.6);
  });
});
