/**
 * Abstract input INTENT and the pure mappings that produce it. The intent is in
 * RAW SCREEN axes (+x = right, +y = down) — exactly what a key press or a touch
 * drag means on screen. The pure game layer (Player) rotates this into the world
 * floor plane by the iso angle; keeping the rotation there (not here) is what
 * guarantees keyboard and touch move IDENTICALLY (both feed the same intent
 * through the same rotation).
 *
 * No three, no DOM. Components in [-1, 1]; magnitude may exceed 1 on the
 * diagonal, so Player normalizes after rotating.
 */

import { clamp } from '../utils/math';

export interface InputIntent {
  /** Horizontal axis: -1 = left, +1 = right, 0 = none (screen space). */
  moveX: number;
  /** Vertical axis: -1 = up, +1 = down, 0 = none (screen space). */
  moveY: number;
}

export function createIntent(): InputIntent {
  return { moveX: 0, moveY: 0 };
}

/** Keys (lowercased) that drive each screen direction. */
export const MOVE_KEYS = {
  left: ['arrowleft', 'a'],
  right: ['arrowright', 'd'],
  up: ['arrowup', 'w'],
  down: ['arrowdown', 's'],
} as const;

const has = (keys: readonly string[], pressed: ReadonlySet<string>): boolean =>
  keys.some((k) => pressed.has(k));

/** Raw screen-space intent from the set of currently-held keys. Pure. */
export function keyAxes(pressed: ReadonlySet<string>): InputIntent {
  let x = 0;
  let y = 0;
  if (has(MOVE_KEYS.left, pressed)) x -= 1;
  if (has(MOVE_KEYS.right, pressed)) x += 1;
  if (has(MOVE_KEYS.up, pressed)) y -= 1;
  if (has(MOVE_KEYS.down, pressed)) y += 1;
  return { moveX: x, moveY: y };
}

/** Raw screen-space intent from a touch drag offset (px) and full-deflection
 *  range (px). Up-screen drag (dy < 0) yields moveY < 0, matching the up keys
 *  — so touch and keyboard produce the SAME intent for the same direction. */
export function dragAxes(dx: number, dy: number, range: number): InputIntent {
  return {
    moveX: clamp(dx / range, -1, 1),
    moveY: clamp(dy / range, -1, 1),
  };
}
