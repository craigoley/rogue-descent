/**
 * RUN-START LEAN choice (meta Layer 2). A small pre-run card (the RunSummary /
 * UnlocksOverlay modal idiom: centered card, tappable rows) shown before floor 1 —
 * "CHOOSE YOUR LEAN": pick a single kind to STEER this run toward (it drops more often
 * + is the guaranteed first powerup), or "No Lean" for pure RNG (= today exactly).
 *
 * App/DOM layer. The chosen lean flows into the run as config.runStart (a pure input);
 * the card itself mutates no sim state. SUPPRESSED on a fresh save (the caller gates on
 * shouldOfferLean) — the ritual arrives after the first unlock. The last pick is
 * pre-selected (meta.runStart) for a quick, deliberate confirm.
 */

import { CSS_PALETTE } from '../utils/constants';

/** 'fireRate' → 'Fire Rate', 'burn' → 'Burn', 'extraCharge' → 'Extra Charge'. */
function labelize(kind: string): string {
  return kind.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export class RunStartCard {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private onChoose: ((lean: string | null) => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'run-start-overlay';
    // Modal: swallow stray pointer/touch behind the card so the run can't be driven
    // while choosing (no kills → no drops before the lean is set).
    this.root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    const card = document.createElement('div');
    card.className = 'run-start-card';

    const title = document.createElement('div');
    title.className = 'run-start-title';
    title.textContent = 'CHOOSE YOUR LEAN';
    title.style.color = CSS_PALETTE.accent;

    const sub = document.createElement('div');
    sub.className = 'run-start-sub';
    sub.textContent = 'Steer this run — your pick drops more often and arrives first.';

    this.list = document.createElement('div');
    this.list.className = 'run-start-list';

    card.append(title, sub, this.list);
    this.root.appendChild(card);
    container.appendChild(this.root);
  }

  /** Show the card for `kinds` (+ a No-Lean option), pre-selecting `current`. Resolves by
   *  invoking `onChoose` with the picked kind (or null for No Lean), then hides. */
  offer(kinds: readonly string[], current: string | null, onChoose: (lean: string | null) => void): void {
    this.onChoose = onChoose;
    const rows: HTMLButtonElement[] = [];
    // "No Lean" first — the purist / decline path (= today exactly).
    rows.push(this.makeRow(null, 'No Lean', 'Pure RNG — no steering.', current === null));
    for (const k of kinds) {
      rows.push(this.makeRow(k, labelize(k), '', current === k));
    }
    this.list.replaceChildren(...rows);
    this.root.classList.add('is-visible');
  }

  private makeRow(lean: string | null, label: string, note: string, selected: boolean): HTMLButtonElement {
    const row = document.createElement('button');
    row.className = 'run-start-row';
    row.classList.toggle('is-selected', selected); // the last pick, pre-highlighted
    const name = document.createElement('span');
    name.className = 'run-start-row-name';
    name.textContent = label;
    row.appendChild(name);
    if (note) {
      const n = document.createElement('span');
      n.className = 'run-start-row-note';
      n.textContent = note;
      row.appendChild(n);
    }
    const fire = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      this.choose(lean);
    };
    row.addEventListener('click', fire);
    row.addEventListener('touchstart', fire, { passive: false });
    return row;
  }

  private choose(lean: string | null): void {
    const cb = this.onChoose;
    this.onChoose = null;
    this.root.classList.remove('is-visible');
    if (cb) cb(lean);
  }
}
