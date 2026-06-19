/**
 * Run-END overlay (Phase 7b permadeath + the W=8 climax). Shown when a run ENDS — in
 * either DEATH (state.runOver, after the death pause → "RUN OVER", accent-red) or
 * VICTORY (state.runWon, beating the final boss → "VICTORY", player-mint + a celebratory
 * variant). Reads UNAMBIGUOUSLY as run-over (not a same-run respawn), then a one-tap/
 * -click/-key RESTART starts a FRESH run via the injected callback. The two end-states
 * are mutually exclusive (the sim guarantees it). PURE RENDER + DOM: reads game state,
 * mutates none.
 *
 * Restart is a plain "start fresh run" callback so a future Phase 9 title screen
 * can redirect it without this overlay assuming anything about menus.
 */

import type { GameState } from '../game/GameState';
import { heatTotal } from '../game/Heat';
import { recordRunDepth } from '../state/Best';
import { applyRunResult, loadMeta, newlyUnlocked, saveMeta, UNLOCKS } from '../state/Meta';
import { CSS_PALETTE, HEAT } from '../utils/constants';

/** Seconds -> "m:ss". */
function formatTime(totalSec: number): string {
  const s = Math.floor(totalSec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Human-readable labels for unlock ids (the run-end toast) — sourced from the unlock
 *  CATALOG (the single source of truth) so the toast + the Unlocks surface never drift. */
const UNLOCK_LABELS: Record<string, string> = Object.fromEntries(UNLOCKS.map((u) => [u.id, u.label]));
const labelFor = (id: string): string => UNLOCK_LABELS[id] ?? id.toUpperCase();

export class RunSummary {
  private readonly root: HTMLDivElement;
  private readonly values: Record<string, HTMLSpanElement> = {};
  private readonly bestEl: HTMLDivElement;
  /** The title — "RUN OVER" (death) or "VICTORY" (win); swapped in update(). */
  private readonly titleEl: HTMLDivElement;
  /** Meta unlock line ("🔓 UNLOCKED: Freeze") — shown only when a run earns one. */
  private readonly unlockEl: HTMLDivElement;
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
    this.titleEl = title;

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

    // Meta unlock line — empty (no visible space) unless this run earned an unlock.
    this.unlockEl = document.createElement('div');
    this.unlockEl.className = 'run-summary-best';
    this.unlockEl.style.color = CSS_PALETTE.freeze;

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

    this.root.append(title, stats, this.bestEl, this.unlockEl, btn);
    container.appendChild(this.root);

    window.addEventListener('keydown', this.onKey);
  }

  /** Desktop: Enter restarts while the summary is up. (Space is intentionally
   *  NOT bound — it's the dash key, and would queue a stray dash on the new run.) */
  private onKey = (e: KeyboardEvent): void => {
    if (!this.shown) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.onRestart();
    }
  };

  /** Show on a run END — death (runOver) OR victory (runWon) — recording the best +
   *  outcome once, hidden when a fresh run begins. The two end-states are mutually
   *  exclusive (sim-guaranteed); `won` distinguishes the title/colour + the meta flag. */
  update(state: GameState): void {
    const ended = state.runOver || state.runWon;
    if (ended && !this.shown) {
      const won = state.runWon;
      // VICTORY (mint, celebratory) vs RUN OVER (accent-red). The .is-victory class adds
      // the win-only flourish in CSS; both reuse the same stat block + restart.
      this.titleEl.textContent = won ? 'VICTORY' : 'RUN OVER';
      this.titleEl.style.color = won ? CSS_PALETTE.player : CSS_PALETTE.accent;
      this.root.classList.toggle('is-victory', won);

      this.values.depth.textContent = `${state.run.depth}`;
      this.values.floors.textContent = `${state.run.floorsCleared}`;
      this.values.kills.textContent = `${state.run.kills}`;
      this.values.time.textContent = formatTime(state.run.timeSec);
      // Record + display the personal best (DISPLAY ONLY — never fed to the sim).
      const best = recordRunDepth(state.run.depth);
      this.bestEl.textContent = `BEST: DEPTH ${best.depth}`;
      // META: apply this run's outcome to the unlock state + show any new unlock. The
      // "beat a boss" signal without new sim state: floorsCleared >= 1 (descent gates
      // on the boss being dead) OR the current floor's boss is dead (killed-but-died-
      // before-descending) OR a WIN (the final boss is dead by definition). The unlock
      // applies to the NEXT run (restart re-reads meta).
      const before = loadMeta();
      const after = applyRunResult(before, {
        depth: state.run.depth,
        bossDefeated: won || state.run.floorsCleared >= 1 || state.bossDefeated,
        wildfireKills: state.run.wildfireKills, // META PR2 — cumulative skill milestone
        // META L3 — record the Heat this run was played at + whether it reached the
        // win-depth W. A win at Heat N records max(prev, N) → the reward stat.
        heat: heatTotal(state.config.heat),
        reachedWinDepth: state.run.depth >= HEAT.unlockDepth,
        won, // W=8 climax — sets the persistent hasWon (the won-badge)
      });
      saveMeta(after);
      const gained = newlyUnlocked(before, after);
      this.unlockEl.textContent = gained.length > 0 ? `🔓 UNLOCKED: ${gained.map(labelFor).join(', ')}` : '';
      this.root.classList.add('is-visible');
      this.shown = true;
    } else if (!ended && this.shown) {
      this.root.classList.remove('is-visible');
      this.shown = false;
    }
  }
}
