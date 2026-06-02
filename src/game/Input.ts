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
import { ISO_YAW } from '../utils/constants';

export interface InputIntent {
  /** Horizontal move axis: -1 = left, +1 = right, 0 = none (screen space). */
  moveX: number;
  /** Vertical move axis: -1 = up, +1 = down, 0 = none (screen space). */
  moveY: number;
  /** Aim direction in SCREEN axes (mouse dir / aim stick). (0,0) = no aim, in
   *  which case attacks use the player's facing (= last move direction). */
  aimX: number;
  aimY: number;
  /** Dash request — EDGE-triggered: set true on the press, consumed (cleared)
   *  by the sim so one press = one dash. */
  dash: boolean;
  /** Melee swing — EDGE-triggered, consumed by the sim. */
  melee: boolean;
  /** Ranged fire — LEVEL (held); the sim fires at the weapon's cooldown rate. */
  ranged: boolean;
}

export function createIntent(): InputIntent {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, dash: false, melee: false, ranged: false };
}

/** Keys (lowercased) that drive each screen direction. */
export const MOVE_KEYS = {
  left: ['arrowleft', 'a'],
  right: ['arrowright', 'd'],
  up: ['arrowup', 'w'],
  down: ['arrowdown', 's'],
} as const;

/** Just the two move axes (a subset of InputIntent) — the pure keyboard/touch
 *  mappings produce these; the adapter copies them onto the live intent. */
export interface MoveAxes {
  moveX: number;
  moveY: number;
}

const has = (keys: readonly string[], pressed: ReadonlySet<string>): boolean =>
  keys.some((k) => pressed.has(k));

/** Raw screen-space move axes from the set of currently-held keys. Pure. */
export function keyAxes(pressed: ReadonlySet<string>): MoveAxes {
  let x = 0;
  let y = 0;
  if (has(MOVE_KEYS.left, pressed)) x -= 1;
  if (has(MOVE_KEYS.right, pressed)) x += 1;
  if (has(MOVE_KEYS.up, pressed)) y -= 1;
  if (has(MOVE_KEYS.down, pressed)) y += 1;
  return { moveX: x, moveY: y };
}

/** Raw screen-space move axes from a touch drag offset (px) and full-deflection
 *  range (px). Up-screen drag (dy < 0) yields moveY < 0, matching the up keys
 *  — so touch and keyboard produce the SAME axes for the same direction. */
export function dragAxes(dx: number, dy: number, range: number): MoveAxes {
  return {
    moveX: clamp(dx / range, -1, 1),
    moveY: clamp(dy / range, -1, 1),
  };
}

/**
 * DIAGNOSTIC: the iso rotation Player applies to raw input, exposed as a pure
 * function so the ?debug=1 trace can show the "after ISO_YAW rotation" stage.
 * This MIRRORS the inline math in updatePlayer (rotation by -ISO_YAW); it is not
 * called by the sim. The "world velocity" trace row reads the actual player
 * state, so comparing the two reveals any divergence between this and Player.
 *
 * Returns a REUSED scratch object — read it immediately; the next call
 * overwrites it. Trig is precomputed at module scope (matching Player.ts).
 */
const _isoCos = Math.cos(-ISO_YAW);
const _isoSin = Math.sin(-ISO_YAW);
const _isoScratch = { x: 0, y: 0 };
export function isoRotate(moveX: number, moveY: number): { x: number; y: number } {
  _isoScratch.x = moveX * _isoCos - moveY * _isoSin;
  _isoScratch.y = moveX * _isoSin + moveY * _isoCos;
  return _isoScratch;
}
