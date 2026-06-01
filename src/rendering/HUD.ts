/**
 * HTML overlay HUD. Always shows the title card. Behind `?debug=1` it adds the
 * tuning panel — the funnel/telemetry surface CLAUDE.md requires AND a live
 * tuning aid: a per-frame readout (fps, sim steps/frame, player position +
 * velocity, interpolation alpha) plus sliders that write straight into the
 * mutable TUNING constants, so feel can be dialled in on-device without a
 * rebuild.
 *
 * Built from DOM nodes once (no innerHTML churn, no per-frame node creation);
 * the per-frame work is just updating textContent. READS game state; the only
 * thing it writes is TUNING (the game layer reads those — never the reverse).
 */

import type { GameState } from '../game/GameState';
import { CSS_PALETTE, TUNING, TUNING_RANGES } from '../utils/constants';

/** True when the page was loaded with `?debug=1`. */
export function isDebugEnabled(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

type TuningKey = keyof typeof TUNING_RANGES;

export class HUD {
  private readonly debug: boolean;
  private readonly readoutEl: HTMLPreElement | null = null;

  constructor(container: HTMLElement) {
    this.debug = isDebugEnabled();

    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = 'ROGUE DESCENT';
    title.style.color = CSS_PALETTE.player;
    container.appendChild(title);

    if (!this.debug) return;

    const panel = document.createElement('div');
    panel.className = 'hud-panel';

    this.readoutEl = document.createElement('pre');
    this.readoutEl.className = 'hud-readout';
    panel.appendChild(this.readoutEl);

    for (const key of Object.keys(TUNING_RANGES) as TuningKey[]) {
      panel.appendChild(this.makeSlider(key));
    }

    container.appendChild(panel);
  }

  /** One labelled slider bound to a TUNING field. Writes live on input. */
  private makeSlider(key: TuningKey): HTMLElement {
    const range = TUNING_RANGES[key];
    const row = document.createElement('label');
    row.className = 'hud-slider';

    const label = document.createElement('span');
    const setLabel = (): void => {
      label.textContent = `${key} ${TUNING[key]}`;
    };
    setLabel();

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.value = String(TUNING[key]);
    input.addEventListener('input', () => {
      TUNING[key] = parseFloat(input.value);
      setLabel();
    });

    row.appendChild(label);
    row.appendChild(input);
    return row;
  }

  /** Refresh the live readout. No-op when debug is off. */
  update(state: GameState, fps: number, steps: number, alpha: number): void {
    if (!this.readoutEl) return;
    const p = state.player;
    const speed = Math.hypot(p.vx, p.vy);
    this.readoutEl.textContent =
      `fps    ${fps.toFixed(0)}\n` +
      `steps  ${steps}/frame   alpha ${alpha.toFixed(2)}\n` +
      `pos    ${p.x.toFixed(2)}, ${p.y.toFixed(2)}\n` +
      `vel    ${p.vx.toFixed(2)}, ${p.vy.toFixed(2)}  (${speed.toFixed(2)})`;
  }
}
