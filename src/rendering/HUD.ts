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
import { Minimap } from './Minimap';
import {
  CSS_PALETTE,
  DASH,
  PLAYER_COMBAT,
  TUNING,
  TUNING_RANGES,
} from '../utils/constants';

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
  private readonly healthFill: HTMLDivElement;
  private readonly dashFill: HTMLDivElement;
  private readonly tutorialEl: HTMLDivElement;
  private tutorialState: 'idle' | 'showing' | 'done' = 'idle';
  private tutorialShownAt = 0;
  private readonly minimap: Minimap;

  constructor(container: HTMLElement) {
    this.debug = isDebugEnabled();
    this.minimap = new Minimap(container);

    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = 'ROGUE DESCENT';
    title.style.color = CSS_PALETTE.player;
    container.appendChild(title);

    // Combat HUD (always on): health bar + dash-readiness pip.
    const bars = document.createElement('div');
    bars.className = 'hud-bars';
    const healthTrack = document.createElement('div');
    healthTrack.className = 'hud-bar hud-health';
    this.healthFill = document.createElement('div');
    this.healthFill.className = 'hud-bar-fill';
    healthTrack.appendChild(this.healthFill);
    const dashTrack = document.createElement('div');
    dashTrack.className = 'hud-bar hud-dash';
    this.dashFill = document.createElement('div');
    this.dashFill.className = 'hud-bar-fill';
    dashTrack.appendChild(this.dashFill);
    bars.appendChild(healthTrack);
    bars.appendChild(dashTrack);
    container.appendChild(bars);

    // One-time dodge tutorial — revealed the first time an enemy telegraphs (the
    // dodge window), so the player learns dash = dodge IN CONTEXT, then it fades.
    this.tutorialEl = document.createElement('div');
    this.tutorialEl.className = 'combat-tutorial';
    this.tutorialEl.textContent = 'DASH through attacks to DODGE';
    container.appendChild(this.tutorialEl);

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

  /** Reveal the dodge tutorial on first enemy telegraph, then retire it after a
   *  few seconds (shown once per page load). Pure DOM; reads state only. */
  private updateTutorial(state: GameState): void {
    if (this.tutorialState === 'done') return;
    if (this.tutorialState === 'idle') {
      const telegraphing = state.enemies.some((e) => e.active && e.phase === 'telegraph');
      if (telegraphing) {
        this.tutorialEl.classList.add('is-visible');
        this.tutorialState = 'showing';
        this.tutorialShownAt = state.time;
      }
      return;
    }
    if (state.time - this.tutorialShownAt > PLAYER_COMBAT.dodgeTutorialDuration) {
      this.tutorialEl.classList.remove('is-visible');
      this.tutorialState = 'done';
    }
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
    const p = state.player;

    // Combat HUD (always): health fraction + dash readiness (0 = cooling down).
    const hp = Math.max(0, p.health) / PLAYER_COMBAT.maxHealth;
    this.healthFill.style.width = `${(hp * 100).toFixed(1)}%`;
    const dashTotal = DASH.duration + TUNING.dashCooldown;
    const dashReady = 1 - Math.min(1, p.dashCdTimer / dashTotal);
    this.dashFill.style.width = `${(dashReady * 100).toFixed(1)}%`;

    // Minimap (always on) — rebuilds itself on floor-change (seed change).
    this.minimap.update(state, alpha);

    this.updateTutorial(state);

    if (!this.readoutEl) return;
    const rot = isoRotate(intent.moveX, intent.moveY);
    const dpx = p.x - p.prevX;
    const dpy = p.y - p.prevY;

    // Stage 5: project the live world velocity (game x -> three x, game y ->
    // three z) through the actual camera. Read the scratch immediately each call.
    const motion = screenLabel(scene.screenDelta(p.x, 0, p.y, p.vx, 0, p.vy));
    const axX = screenLabel(scene.screenDelta(p.x, 0, p.y, 1, 0, 0));
    const axZ = screenLabel(scene.screenDelta(p.x, 0, p.y, 0, 0, 1));
    const axUp = screenLabel(scene.screenDelta(p.x, 0, p.y, 0, 1, 0));

    // Phase 5 funnel: room lifecycle + drops.
    let cleared = 0;
    let spawned = 0;
    let collected = 0;
    for (const enc of state.rooms) {
      if (enc.phase === 'cleared') cleared++;
      spawned += enc.dropsSpawned;
      collected += enc.dropsCollected;
    }

    this.readoutEl.textContent =
      `fps ${fps.toFixed(0)}   steps ${steps}/f   alpha ${alpha.toFixed(2)}\n` +
      `floor seed ${state.seed}   (press G to regenerate)\n` +
      `rooms ${cleared}/${state.rooms.length} cleared  active ${state.activeRoom}` +
      `  buff×${state.player.fireRateMult.toFixed(2)}\n` +
      `drops spawned ${spawned} / collected ${collected}\n` +
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
