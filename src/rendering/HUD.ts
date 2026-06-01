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
import { isoRotate, type InputIntent } from '../game/Input';
import type { SceneManager } from './SceneManager';
import { CSS_PALETTE, TUNING, TUNING_RANGES } from '../utils/constants';

const f2 = (n: number): string => n.toFixed(2);
/** Format an NDC screen delta and tag the dominant visual direction. */
function screenLabel(s: { x: number; y: number }): string {
  const mag = Math.hypot(s.x, s.y);
  if (mag < 1e-4) return `(${f2(s.x)}, ${f2(s.y)})  —`;
  const horiz = s.x > 0 ? 'right' : 'left';
  const vert = s.y > 0 ? 'up' : 'down';
  // "pure" if one component dominates the other by 10x.
  let dir: string;
  if (Math.abs(s.x) < Math.abs(s.y) / 10) dir = vert;
  else if (Math.abs(s.y) < Math.abs(s.x) / 10) dir = horiz;
  else dir = `${vert}-${horiz}`;
  return `(${f2(s.x)}, ${f2(s.y)})  ${dir}`;
}

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

  /**
   * Refresh the live readout + the full input→screen TRACE. No-op when debug
   * off. The trace shows every stage of the transform for the CURRENT input so
   * we can read on-device exactly where "screen-up" stops being up:
   *
   *   1 raw input            (from Controls, screen axes: +x right, +y down)
   *   2 after ISO_YAW        (Input.isoRotate — mirrors Player's rotation)
   *   3 world velocity       (ACTUAL, read from player state)
   *   4 pos delta / step     (ACTUAL, current - prev)
   *   5 motion → SCREEN      (world velocity through the REAL camera.project)
   *
   * Plus the real-camera projection of the world axes, so the grid orientation
   * (grid lines run along world X / Z) is visible next to the motion.
   */
  update(
    state: GameState,
    fps: number,
    steps: number,
    alpha: number,
    intent: InputIntent,
    scene: SceneManager,
  ): void {
    if (!this.readoutEl) return;
    const p = state.player;
    const rot = isoRotate(intent.moveX, intent.moveY);
    const dpx = p.x - p.prevX;
    const dpy = p.y - p.prevY;

    // Stage 5: project the live world velocity (game x -> three x, game y ->
    // three z) through the actual camera. Read the scratch immediately each call.
    const motion = screenLabel(scene.screenDelta(p.x, 0, p.y, p.vx, 0, p.vy));
    const axX = screenLabel(scene.screenDelta(p.x, 0, p.y, 1, 0, 0));
    const axZ = screenLabel(scene.screenDelta(p.x, 0, p.y, 0, 0, 1));
    const axUp = screenLabel(scene.screenDelta(p.x, 0, p.y, 0, 1, 0));

    this.readoutEl.textContent =
      `fps ${fps.toFixed(0)}   steps ${steps}/f   alpha ${alpha.toFixed(2)}\n` +
      `\n` +
      `INPUT TRACE (press a direction)\n` +
      `1 raw input     ${f2(intent.moveX)}, ${f2(intent.moveY)}\n` +
      `2 after ISO_YAW ${f2(rot.x)}, ${f2(rot.y)}\n` +
      `3 world vel     ${f2(p.vx)}, ${f2(p.vy)}\n` +
      `4 pos delta     ${f2(dpx)}, ${f2(dpy)}\n` +
      `5 motion→screen ${motion}\n` +
      `\n` +
      `CAMERA basis (real .project, x=right y=up)\n` +
      `world +X        ${axX}\n` +
      `world +Z (g.y)  ${axZ}\n` +
      `world +Y (up)   ${axUp}`;
  }
}
