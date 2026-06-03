/**
 * Run-over / game-over overlay (Phase 7b permadeath). Shown when state.runOver
 * flips true (after the death pause). Reads UNAMBIGUOUSLY as RUN OVER — not a
 * same-run respawn — then a one-tap/-click/-key RESTART starts a FRESH run via
 * the injected callback. PURE RENDER + DOM: reads game state, mutates none.
 *
 * Restart is a plain "start fresh run" callback so a future Phase 9 title screen
 * can redirect it without this overlay assuming anything about menus.
 */

import type { GameState } from '../game/GameState';
import { recordRunDepth } from '../state/Best';
import { CSS_PALETTE } from '../utils/constants';

/** Seconds -> "m:ss". */
function formatTime(totalSec: number): string {
  const s = Math.floor(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class RunSummary {
  private readonly root: HTMLDivElement;
  private readonly values: Record<string, HTMLSpanElement> = {};
  private readonly bestEl: HTMLDivElement;
  private shown = false;
  private readonly onRestart: () => void;

  constructor(container: HTMLElement, onRestart: () => void) {
    this.onRestart = onRestart;

    this.root = document.createElement('div');
    this.root.className = 'run-summary';
    // Block input behind the modal (the move/aim sticks listen on the container);
    // the sim is frozen anyway, this just stops stray stick visuals.
    this.root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'run-summary-title';
    title.textContent = 'RUN OVER';
    title.style.color = CSS_PALETTE.accent;

    const stats = document.createElement('div');
    stats.className = 'run-summary-stats';
    for (const [key, label] of [
      ['depth', 'DEPTH'],
      ['floors', 'FLOORS CLEARED'],
      ['kills', 'KILLS'],
      ['time', 'TIME'],
    ] as const) {
      const row = document.createElement('div');
      row.className = 'run-summary-row';
      const l = document.createElement('span');
      l.className = 'run-summary-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'run-summary-value';
      this.values[key] = v;
      row.append(l, v);
      stats.appendChild(row);
    }

    this.bestEl = document.createElement('div');
    this.bestEl.className = 'run-summary-best';

    const btn = document.createElement('button');
    btn.className = 'run-summary-restart';
    btn.textContent = 'RESTART';
    btn.style.color = CSS_PALETTE.player;
    const fire = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      this.onRestart();
    };
    btn.addEventListener('click', fire);
    btn.addEventListener('touchstart', fire, { passive: false });

    this.root.append(title, stats, this.bestEl, btn);
    container.appendChild(this.root);

    window.addEventListener('keydown', this.onKey);
  }

  /** Desktop: Enter / Space restart while the summary is up. */
  private onKey = (e: KeyboardEvent): void => {
    if (!this.shown) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      this.onRestart();
    }
  };

  /** Show on run-over (recording the best once), hide when a fresh run begins. */
  update(state: GameState): void {
    if (state.runOver && !this.shown) {
      this.values.depth.textContent = `${state.run.depth}`;
      this.values.floors.textContent = `${state.run.floorsCleared}`;
      this.values.kills.textContent = `${state.run.kills}`;
      this.values.time.textContent = formatTime(state.run.timeSec);
      // Record + display the personal best (DISPLAY ONLY — never fed to the sim).
      const best = recordRunDepth(state.run.depth);
      this.bestEl.textContent = `BEST: DEPTH ${best.depth}`;
      this.root.classList.add('is-visible');
      this.shown = true;
    } else if (!state.runOver && this.shown) {
      this.root.classList.remove('is-visible');
      this.shown = false;
    }
  }
}
