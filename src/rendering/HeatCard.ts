/**
 * HEAT choice (meta Layer 3). A pre-run card (the RunStartCard / RunSummary modal idiom)
 * shown AFTER the first win — "SET YOUR HEAT": author your challenge by setting each
 * modifier's rank with +/- steppers; the running total is your Heat number; win at the
 * reward threshold to unlock more variety.
 *
 * App/DOM layer. The chosen HeatConfig flows into the run as config.heat (a pure input);
 * the card mutates no sim state. SUPPRESSED until the first win (the caller gates on
 * shouldOfferHeat). The last pick (meta.heat) is pre-loaded for a quick, deliberate confirm.
 */

import { HEAT } from '../utils/constants';
import { HEAT_MODS, NO_HEAT, heatTotal, normalizeHeat, type HeatConfig } from '../game/Heat';

export class HeatCard {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly totalEl: HTMLSpanElement;
  /** The working config (a copy; steppers mutate it, CONFIRM resolves it). */
  private heat: HeatConfig = { ...NO_HEAT };
  private onConfirm: ((heat: HeatConfig) => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'run-start-overlay'; // reuse the lean-card modal frame
    this.root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());

    const card = document.createElement('div');
    card.className = 'run-start-card heat-card';

    const title = document.createElement('div');
    title.className = 'run-start-title';
    title.textContent = 'SET YOUR HEAT';

    const sub = document.createElement('div');
    sub.className = 'run-start-sub';
    sub.textContent = `Author your challenge — harder enemies, never a weaker you. Win at Heat ${HEAT.fireRateRewardHeat}+ to unlock Fire Rate.`;

    this.list = document.createElement('div');
    this.list.className = 'run-start-list';

    // Footer: running Heat total + the confirm button.
    const footer = document.createElement('div');
    footer.className = 'heat-footer';
    const total = document.createElement('div');
    total.className = 'heat-total';
    total.append('HEAT ');
    this.totalEl = document.createElement('span');
    this.totalEl.className = 'heat-total-num';
    total.appendChild(this.totalEl);
    const confirm = document.createElement('button');
    confirm.className = 'heat-confirm';
    confirm.textContent = 'DESCEND';
    const fire = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      this.confirm();
    };
    confirm.addEventListener('click', fire);
    confirm.addEventListener('touchstart', fire, { passive: false });
    footer.append(total, confirm);

    card.append(title, sub, this.list, footer);
    this.root.appendChild(card);
    container.appendChild(this.root);
  }

  /** Show the card pre-loaded with `current` ranks. Resolves by invoking `onConfirm`
   *  with the chosen HeatConfig, then hides. */
  offer(current: HeatConfig, onConfirm: (heat: HeatConfig) => void): void {
    this.onConfirm = onConfirm;
    this.heat = normalizeHeat(current);
    this.list.replaceChildren(...HEAT_MODS.map((m) => this.makeRow(m.id)));
    this.refreshTotal();
    this.root.classList.add('is-visible');
  }

  /** One modifier row: label + blurb + a [- rank/max +] stepper. */
  private makeRow(id: keyof HeatConfig): HTMLDivElement {
    const def = HEAT_MODS.find((m) => m.id === id)!;
    const row = document.createElement('div');
    row.className = 'run-start-row heat-row';

    const text = document.createElement('div');
    text.className = 'heat-row-text';
    const name = document.createElement('span');
    name.className = 'run-start-row-name';
    name.textContent = `${def.label}  (+${def.heatPerRank} Heat/rank)`;
    const note = document.createElement('span');
    note.className = 'run-start-row-note';
    note.textContent = def.description;
    text.append(name, note);

    const stepper = document.createElement('div');
    stepper.className = 'heat-stepper';
    const rankEl = document.createElement('span');
    rankEl.className = 'heat-rank';
    const render = (): void => {
      rankEl.textContent = `${this.heat[id]} / ${def.maxRank}`;
    };
    const step = (delta: number) => (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      this.heat[id] = Math.max(0, Math.min(def.maxRank, this.heat[id] + delta));
      render();
      this.refreshTotal();
    };
    const minus = this.makeStepBtn('−', step(-1));
    const plus = this.makeStepBtn('+', step(1));
    stepper.append(minus, rankEl, plus);
    render();

    row.append(text, stepper);
    return row;
  }

  private makeStepBtn(glyph: string, handler: (e: Event) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'heat-step-btn';
    b.textContent = glyph;
    b.addEventListener('click', handler);
    b.addEventListener('touchstart', handler, { passive: false });
    return b;
  }

  private refreshTotal(): void {
    this.totalEl.textContent = String(heatTotal(this.heat));
  }

  private confirm(): void {
    const cb = this.onConfirm;
    this.onConfirm = null;
    this.root.classList.remove('is-visible');
    if (cb) cb(this.heat);
  }
}
