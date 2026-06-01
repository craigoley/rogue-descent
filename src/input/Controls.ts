/**
 * The impure input adapter: it owns the DOM event listeners (keyboard + touch)
 * and folds them down into the pure `InputIntent` the game layer reads. This is
 * deliberately the ONLY place that touches `window`/DOM for input, so the game
 * layer (src/game/Input.ts) stays Node-testable.
 *
 * Keyboard and touch are at PARITY: both produce the same raw screen-space
 * intent via the pure mappings in Input.ts, and Player applies the same iso
 * rotation to whichever one is active — so they move identically.
 *
 * Touch shows a VISIBLE virtual stick: a base ring appears where the finger
 * lands and a thumb tracks the drag (clamped to TOUCH.range). Without a visible
 * control the game looked frozen on mobile (a tap with no drag = zero input).
 */

import {
  createIntent,
  dragAxes,
  keyAxes,
  type InputIntent,
} from '../game/Input';
import { TOUCH } from '../utils/constants';

export class Controls {
  readonly intent: InputIntent = createIntent();
  private readonly pressed = new Set<string>();

  private touchId: number | null = null;
  private originX = 0;
  private originY = 0;

  // Virtual-stick DOM (created once; just shown/moved/hidden on touch events).
  private readonly stickBase: HTMLDivElement;
  private readonly stickThumb: HTMLDivElement;
  private readonly hint: HTMLDivElement | null = null;

  constructor(target: HTMLElement = document.body) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('touchstart', this.onTouchStart, { passive: false });
    target.addEventListener('touchmove', this.onTouchMove, { passive: false });
    target.addEventListener('touchend', this.onTouchEnd);
    target.addEventListener('touchcancel', this.onTouchEnd);

    this.stickBase = document.createElement('div');
    this.stickBase.className = 'touch-stick-base';
    this.stickThumb = document.createElement('div');
    this.stickThumb.className = 'touch-stick-thumb';
    target.appendChild(this.stickBase);
    target.appendChild(this.stickThumb);

    // Discoverability: a one-time hint on touch-capable devices.
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.hint = document.createElement('div');
      this.hint.className = 'touch-hint';
      this.hint.textContent = 'Drag anywhere to move';
      target.appendChild(this.hint);
    }
  }

  // --- Keyboard -------------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent): void => {
    this.pressed.add(e.key.toLowerCase());
    this.applyKeys();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.key.toLowerCase());
    this.applyKeys();
  };

  private applyKeys(): void {
    const a = keyAxes(this.pressed);
    this.intent.moveX = a.moveX;
    this.intent.moveY = a.moveY;
  }

  // --- Touch: a visible virtual stick anchored where the finger lands --------
  private onTouchStart = (e: TouchEvent): void => {
    if (this.touchId !== null) return;
    const t = e.changedTouches[0];
    this.touchId = t.identifier;
    this.originX = t.clientX;
    this.originY = t.clientY;
    this.showStick(t.clientX, t.clientY);
    if (this.hint) this.hint.classList.add('is-hidden');
    e.preventDefault();
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchId === null) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue;
      const dx = t.clientX - this.originX;
      const dy = t.clientY - this.originY;
      const a = dragAxes(dx, dy, TOUCH.range);
      this.intent.moveX = a.moveX;
      this.intent.moveY = a.moveY;
      // Move the thumb to the (clamped) drag offset for visible feedback.
      this.moveThumb(a.moveX * TOUCH.range, a.moveY * TOUCH.range);
      e.preventDefault();
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.touchId) continue;
      this.touchId = null;
      this.intent.moveX = 0;
      this.intent.moveY = 0;
      this.hideStick();
    }
  };

  // --- Stick visuals --------------------------------------------------------
  private showStick(x: number, y: number): void {
    this.stickBase.style.left = `${x}px`;
    this.stickBase.style.top = `${y}px`;
    this.stickBase.classList.add('is-active');
    this.moveThumb(0, 0);
    this.stickThumb.classList.add('is-active');
  }

  private moveThumb(offX: number, offY: number): void {
    this.stickThumb.style.left = `${this.originX + offX}px`;
    this.stickThumb.style.top = `${this.originY + offY}px`;
  }

  private hideStick(): void {
    this.stickBase.classList.remove('is-active');
    this.stickThumb.classList.remove('is-active');
  }
}
