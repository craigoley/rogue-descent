/**
 * The impure input adapter: owns every DOM listener and folds them into the pure
 * `InputIntent` the game layer reads. The ONLY place that touches window/DOM for
 * input, so src/game/ stays Node-testable.
 *
 * Twin-stick scheme (stated in the PR):
 *  - Desktop: WASD/arrows move; MOUSE aims (the loop computes aim from the
 *    player's screen position); LEFT mouse or K = ranged (held, auto-fires);
 *    RIGHT mouse or J = melee; SPACE = dash.
 *  - Mobile: LEFT half = move stick; RIGHT half = aim stick (auto-fires ranged
 *    while deflected); on-screen MELEE and DASH buttons.
 *
 * Keyboard and touch are at PARITY: both feed the same intent through the same
 * pure rotation in Player. Edge actions (dash, melee) are set here and CONSUMED
 * (cleared) by the sim, so one press = one action.
 */

import { createIntent, dragAxes, keyAxes, type InputIntent } from '../game/Input';
import { TOUCH } from '../utils/constants';

export class Controls {
  readonly intent: InputIntent = createIntent();

  /** Latest mouse position (client px) + whether a mouse has ever moved — the
   *  loop reads these to compute aim from the player's screen position. */
  mouseX = 0;
  mouseY = 0;
  hasMouse = false;

  private readonly pressed = new Set<string>();
  private leftMouseDown = false;
  private kHeld = false;
  private aimActive = false;

  // Two independent touches: move (left half) and aim (right half).
  private moveTouchId: number | null = null;
  private moveOX = 0;
  private moveOY = 0;
  private aimTouchId: number | null = null;
  private aimOX = 0;
  private aimOY = 0;

  private readonly moveBase: HTMLDivElement;
  private readonly moveThumb: HTMLDivElement;
  private readonly aimBase: HTMLDivElement;
  private readonly aimThumb: HTMLDivElement;
  private readonly hint: HTMLDivElement | null = null;
  private readonly target: HTMLElement;

  constructor(target: HTMLElement = document.body) {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContextMenu);
    target.addEventListener('touchstart', this.onTouchStart, { passive: false });
    target.addEventListener('touchmove', this.onTouchMove, { passive: false });
    target.addEventListener('touchend', this.onTouchEnd);
    target.addEventListener('touchcancel', this.onTouchEnd);

    this.moveBase = Controls.makeStick('touch-stick-base');
    this.moveThumb = Controls.makeStick('touch-stick-thumb');
    this.aimBase = Controls.makeStick('touch-stick-base touch-aim');
    this.aimThumb = Controls.makeStick('touch-stick-thumb touch-aim');
    target.append(this.moveBase, this.moveThumb, this.aimBase, this.aimThumb);

    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.makeButton('MELEE', 'touch-btn-melee', () => {
        this.intent.melee = true;
      });
      this.makeButton('DASH', 'touch-btn-dash', () => {
        this.intent.dash = true;
      });
      this.hint = document.createElement('div');
      this.hint.className = 'touch-hint';
      this.hint.textContent = 'Left: move · Right: aim+fire';
      target.appendChild(this.hint);
    }
  }

  private static makeStick(className: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = className;
    return el;
  }

  private makeButton(label: string, className: string, onPress: () => void): void {
    const b = document.createElement('button');
    b.className = `touch-action ${className}`;
    b.textContent = label;
    const press = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      onPress();
    };
    b.addEventListener('touchstart', press, { passive: false });
    b.addEventListener('mousedown', press);
    this.target.appendChild(b);
  }

  // --- Keyboard -------------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.pressed.add(k);
    this.applyKeys();
    if (e.repeat) return; // edge actions ignore OS key-repeat
    if (k === ' ' || k === 'spacebar') this.intent.dash = true;
    if (k === 'j') this.intent.melee = true;
    if (k === 'k') {
      this.kHeld = true;
      this.updateRanged();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    this.pressed.delete(k);
    this.applyKeys();
    if (k === 'k') {
      this.kHeld = false;
      this.updateRanged();
    }
  };

  private applyKeys(): void {
    const a = keyAxes(this.pressed);
    this.intent.moveX = a.moveX;
    this.intent.moveY = a.moveY;
  }

  private updateRanged(): void {
    this.intent.ranged = this.leftMouseDown || this.kHeld || this.aimActive;
  }

  // --- Mouse ----------------------------------------------------------------
  private onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.hasMouse = true;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.leftMouseDown = true;
      this.updateRanged();
    } else if (e.button === 2) {
      this.intent.melee = true;
      e.preventDefault();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.leftMouseDown = false;
      this.updateRanged();
    }
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault(); // right-click is melee, not a context menu
  };

  // --- Touch: move stick (left) + aim stick (right) -------------------------
  private onTouchStart = (e: TouchEvent): void => {
    for (const t of e.changedTouches) {
      const leftHalf = t.clientX < window.innerWidth / 2;
      if (leftHalf && this.moveTouchId === null) {
        this.moveTouchId = t.identifier;
        this.moveOX = t.clientX;
        this.moveOY = t.clientY;
        Controls.showStick(this.moveBase, this.moveThumb, t.clientX, t.clientY);
        if (this.hint) this.hint.classList.add('is-hidden');
        e.preventDefault();
      } else if (!leftHalf && this.aimTouchId === null) {
        this.aimTouchId = t.identifier;
        this.aimOX = t.clientX;
        this.aimOY = t.clientY;
        Controls.showStick(this.aimBase, this.aimThumb, t.clientX, t.clientY);
        e.preventDefault();
      }
    }
  };

  private onTouchMove = (e: TouchEvent): void => {
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveTouchId) {
        const a = dragAxes(t.clientX - this.moveOX, t.clientY - this.moveOY, TOUCH.range);
        this.intent.moveX = a.moveX;
        this.intent.moveY = a.moveY;
        Controls.moveThumbTo(this.moveThumb, this.moveOX, this.moveOY, a.moveX, a.moveY);
        e.preventDefault();
      } else if (t.identifier === this.aimTouchId) {
        const a = dragAxes(t.clientX - this.aimOX, t.clientY - this.aimOY, TOUCH.range);
        this.intent.aimX = a.moveX;
        this.intent.aimY = a.moveY;
        this.aimActive = a.moveX !== 0 || a.moveY !== 0;
        this.updateRanged();
        Controls.moveThumbTo(this.aimThumb, this.aimOX, this.aimOY, a.moveX, a.moveY);
        e.preventDefault();
      }
    }
  };

  private onTouchEnd = (e: TouchEvent): void => {
    for (const t of e.changedTouches) {
      if (t.identifier === this.moveTouchId) {
        this.moveTouchId = null;
        this.intent.moveX = 0;
        this.intent.moveY = 0;
        Controls.hideStick(this.moveBase, this.moveThumb);
      } else if (t.identifier === this.aimTouchId) {
        this.aimTouchId = null;
        this.intent.aimX = 0;
        this.intent.aimY = 0;
        this.aimActive = false;
        this.updateRanged();
        Controls.hideStick(this.aimBase, this.aimThumb);
      }
    }
  };

  // --- Stick visuals --------------------------------------------------------
  private static showStick(base: HTMLDivElement, thumb: HTMLDivElement, x: number, y: number): void {
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
    base.classList.add('is-active');
    thumb.style.left = `${x}px`;
    thumb.style.top = `${y}px`;
    thumb.classList.add('is-active');
  }

  private static moveThumbTo(
    thumb: HTMLDivElement,
    ox: number,
    oy: number,
    nx: number,
    ny: number,
  ): void {
    thumb.style.left = `${ox + nx * TOUCH.range}px`;
    thumb.style.top = `${oy + ny * TOUCH.range}px`;
  }

  private static hideStick(base: HTMLDivElement, thumb: HTMLDivElement): void {
    base.classList.remove('is-active');
    thumb.classList.remove('is-active');
  }
}
