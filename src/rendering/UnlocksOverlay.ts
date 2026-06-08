/**
 * UNLOCKS surface (meta PR3 — closes Layer 1). A small, on-demand overlay (the
 * RunSummary modal idiom: centered card, Esc / outside-tap dismiss) reached from a
 * "Unlocks…" settings row. Shows, for each catalog entry, whether it's UNLOCKED (✓ +
 * what it is) or LOCKED (its milestone hint + LIVE progress, e.g. "12/30").
 *
 * PURELY INFORMATIONAL + READ-ONLY: it renders unlockProgress(loadMeta()) and mutates
 * nothing — milestone unlocks auto-apply at run-end (applyRunResult); the #77 toast
 * announces the moment. App/DOM layer; src/game is untouched. Rebuilds on every open
 * so progress is always current.
 */

import { loadMeta, unlockProgress, type UnlockRow } from '../state/Meta';
import { CSS_PALETTE } from '../utils/constants';

export class UnlocksOverlay {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private open = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'unlocks-overlay';
    // Swallow stray pointer/touch behind the card (mirrors RunSummary).
    this.root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    const card = document.createElement('div');
    card.className = 'unlocks-card';

    const title = document.createElement('div');
    title.className = 'unlocks-title';
    title.textContent = 'UNLOCKS';
    title.style.color = CSS_PALETTE.accent;

    this.list = document.createElement('div');
    this.list.className = 'unlocks-list';

    const close = document.createElement('button');
    close.className = 'unlocks-close';
    close.textContent = 'CLOSE';
    close.style.color = CSS_PALETTE.player;
    const fire = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    };
    close.addEventListener('click', fire);
    close.addEventListener('touchstart', fire, { passive: false });

    card.append(title, this.list, close);
    this.root.appendChild(card);
    container.appendChild(this.root);

    // Dismiss: Escape, or a tap/click OUTSIDE the card (taps on the card don't count).
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (!card.contains(e.target as Node)) this.close();
    });
  }

  /** Rebuild from the persisted meta (always-fresh progress) and show. */
  show(): void {
    this.list.replaceChildren(...unlockProgress(loadMeta()).map((row) => this.makeRow(row)));
    this.root.classList.add('is-visible');
    this.open = true;
  }

  close(): void {
    if (!this.open) return;
    this.root.classList.remove('is-visible');
    this.open = false;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** One unlockable row: ✓/🔒 status, name, what-it-is, and the milestone hint with
   *  live progress (a count for trackable milestones; done/not for binary ones). */
  private makeRow(row: UnlockRow): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'unlocks-row';
    el.classList.toggle('is-unlocked', row.unlocked);

    const head = document.createElement('div');
    head.className = 'unlocks-row-head';
    const name = document.createElement('span');
    name.className = 'unlocks-row-name';
    name.textContent = `${row.unlocked ? '✓' : '🔒'} ${row.label}`;
    const status = document.createElement('span');
    status.className = 'unlocks-row-status';
    status.textContent = row.unlocked ? 'UNLOCKED' : this.progressText(row);
    head.append(name, status);

    const desc = document.createElement('div');
    desc.className = 'unlocks-row-desc';
    // Unlocked → what it is; locked → the same description as a teaser, then the hint.
    desc.textContent = row.unlocked ? row.description : `${row.description}  ·  ${row.hint}`;

    el.append(head, desc);
    return el;
  }

  /** Locked-state progress: a count for trackable milestones ("12/30"), or the hint
   *  alone for a binary one (no meaningful fraction). */
  private progressText(row: UnlockRow): string {
    return row.binary ? row.hint : `${row.current}/${row.target}`;
  }
}
