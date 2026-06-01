/**
 * HTML overlay HUD. The title card plus a debug overlay gated behind `?debug=1`
 * — the seed of the funnel/telemetry surface every later phase reports through.
 * Built from DOM nodes (no innerHTML churn) and updated by READING game state.
 */

import type { GameState } from '../game/GameState';
import { CSS_PALETTE } from '../utils/constants';

/** True when the page was loaded with `?debug=1`. */
export function isDebugEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

export class HUD {
  private readonly debug: boolean;
  private readonly debugEl: HTMLDivElement | null = null;

  constructor(container: HTMLElement) {
    this.debug = isDebugEnabled();

    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = 'ROGUE DESCENT';
    title.style.color = CSS_PALETTE.player;
    container.appendChild(title);

    if (this.debug) {
      this.debugEl = document.createElement('div');
      this.debugEl.className = 'hud-debug';
      container.appendChild(this.debugEl);
    }
  }

  /** Refresh the debug readout. No-op when debug is off. */
  update(state: GameState, fps: number): void {
    if (!this.debugEl) return;
    const { x, y } = state.player;
    this.debugEl.textContent = `fps ${fps.toFixed(0)}  ·  x ${x.toFixed(2)}  y ${y.toFixed(2)}`;
  }
}
