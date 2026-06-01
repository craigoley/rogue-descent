/**
 * The impure input adapter: it owns the DOM event listeners (keyboard + touch)
 * and folds them down into the pure `InputIntent` the game layer reads. This is
 * deliberately the ONLY place that touches `window`/DOM for input, so the game
 * layer (src/game/Input.ts) stays Node-testable.
 *
 * Touch and keyboard are at parity: both produce the same moveX/moveY axes, per
 * the mobile-required rule in CLAUDE.md.
 */

import { createIntent, type InputIntent } from '../game/Input';
import { clamp } from '../utils/math';

const LEFT_KEYS = new Set(['arrowleft', 'a']);
const RIGHT_KEYS = new Set(['arrowright', 'd']);
const UP_KEYS = new Set(['arrowup', 'w']);
const DOWN_KEYS = new Set(['arrowdown', 's']);

/** Pixels of touch drag that map to full deflection on an axis. */
const TOUCH_RANGE = 60;

export class Controls {
  readonly intent: InputIntent = createIntent();
  private readonly pressed = new Set<string>();
  private touchId: number | null = null;
  private touchOriginX = 0;
  private touchOriginY = 0;

  constructor(target: HTMLElement = document.body) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('touchstart', this.onTouchStart, { passive: false });
    target.addEventListener('touchmove', this.onTouchMove, { passive: false });
    target.addEventListener('touchend', this.onTouchEnd);
    target.addEventListener('touchcancel', this.onTouchEnd);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.pressed.add(e.key.toLowerCase());
    this.applyKeys();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.key.toLowerCase());
    this.applyKeys();
  };

  private applyKeys(): void {
    let x = 0;
    let y = 0;
    for (const k of this.pressed) {
      if (LEFT_KEYS.has(k)) x -= 1;
      if (RIGHT_KEYS.has(k)) x += 1;
      if (UP_KEYS.has(k)) y -= 1;
      if (DOWN_KEYS.has(k)) y += 1;
    }
    this.intent.moveX = clamp(x, -1, 1);
    this.intent.moveY = clamp(y, -1, 1);
  }

  // Touch: a relative virtual stick anchored where the finger first lands.
  private onTouchStart = (e: TouchEvent): void => {
    if (this.touchId !== null) return;
    const t = e.changedTouches[0];
    this.touchId = t.identifier;
    this.touchOriginX = t.clientX;
    this.touchOriginY = t.clientY;
    e.preventDefault();
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchId === null) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue;
      this.intent.moveX = clamp((t.clientX - this.touchOriginX) / TOUCH_RANGE, -1, 1);
      this.intent.moveY = clamp((t.clientY - this.touchOriginY) / TOUCH_RANGE, -1, 1);
      e.preventDefault();
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue;
      this.touchId = null;
      this.intent.moveX = 0;
      this.intent.moveY = 0;
    }
  };
}
