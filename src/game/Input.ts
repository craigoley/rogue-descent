/**
 * Abstract input INTENT. PURE — and deliberately ignorant of how the intent was
 * produced: keyboard, touch and (later) gamepad all map down to this same
 * struct in the input layer (src/input/Controls.ts). The game layer only ever
 * READS an InputIntent.
 *
 * No three, no DOM. Components in [-1, 1]; the magnitude may exceed 1 on the
 * diagonal, so consumers normalize before applying speed.
 */

export interface InputIntent {
  /** Horizontal move axis: -1 = left (-x), +1 = right (+x), 0 = none. */
  moveX: number;
  /** Depth move axis: -1 = far (-y), +1 = near (+y), 0 = none. */
  moveY: number;
}

export function createIntent(): InputIntent {
  return { moveX: 0, moveY: 0 };
}
