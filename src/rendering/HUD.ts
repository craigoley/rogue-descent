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
import type { RoomEncounter } from '../game/Encounter';
import { isoRotate, type InputIntent } from '../game/Input';
import { isSolid } from '../game/Room';
import { dashMaxCharges } from '../game/Player';
import type { Controls } from '../input/Controls';
import {
  damageMultForDepth,
  enemiesPerRoomForDepth,
  healthMultForDepth,
  rangedCountForDepth,
  speedMultForDepth,
} from '../game/Difficulty';
import { loadBest } from '../state/Best';
import type { SceneManager } from './SceneManager';
import { Minimap } from './Minimap';
import { nearestLiveEnemyInRoom } from './softlock';
import {
  CSS_PALETTE,
  DASH,
  PLAYER_COMBAT,
  POWERUP_MAX_LEVEL,
  SOFTLOCK_DETECT,
  TUNING,
  TUNING_RANGES,
  VIGNETTE,
} from '../utils/constants';

/** A leveled-powerup chip (Phase 9): the chip element + its pip dots. */
interface LevelChip {
  chip: HTMLSpanElement;
  pips: HTMLSpanElement[];
}

/** Light the chip when held (level > 0) and fill `level` pips. */
function setChipLevel(c: LevelChip, level: number): void {
  c.chip.classList.toggle('is-on', level > 0);
  for (let i = 0; i < c.pips.length; i++) c.pips[i].classList.toggle('is-filled', i < level);
}

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
  // Softlock instrumentation (ALWAYS ON, render-layer only): previous-frame
  // snapshots so the HUD can log kill (active true->false) + room-cleared
  // transitions to the console for BOTH players (no ?debug needed). READ-ONLY.
  private readonly prevActive: boolean[] = [];
  private readonly prevPhase: string[] = [];
  // Softlock AUTO-DETECTOR (always on; banner only appears when pathological, so
  // normal play is unaffected). Detection ONLY — reads state, never mutates it.
  private readonly softlockBannerEl: HTMLDivElement;
  /** Accumulated no-progress time (sim seconds) in the active room. */
  private stallTimer = 0;
  /** Last sim time seen — frame delta drives accumulation (resets on floor). */
  private prevTime = 0;
  /** Baselines for the progress heuristic (Infinity => first check resets). */
  private prevHealthSum = Infinity;
  private prevNearest = Infinity;
  /** Rising-edge latch: fire/banner once per stall, clear on recovery. */
  private softlockFired = false;
  private readonly healthFill: HTMLDivElement;
  /** Full-screen damage vignette (juice): red edge-glow, opacity driven each frame
   *  from player.hitFlashTimer — the "I got hit" signal. Render-only. */
  private readonly damageVignette: HTMLDivElement;
  /** Accessibility reduce-motion (set by main.ts from Settings). When on, the vignette
   *  uses the softened peak (VIGNETTE.reducedOpacity) — it stays present as combat info,
   *  while camera shake (handled in main.ts) goes to 0. Render-side only. */
  private reduceMotion = false;
  // Boss HP bar (Phase 8): top-centre, shown only while a boss lives.
  private readonly bossWrap: HTMLDivElement;
  private readonly bossFill: HTMLDivElement;
  private readonly bossPhaseMark: HTMLDivElement;
  private readonly dashPips: HTMLDivElement[] = [];
  private readonly dashPipFills: HTMLDivElement[] = [];
  private readonly depthEl: HTMLDivElement;
  /** Leveled-powerup chips (Phase 9): each shows up to POWERUP_MAX_LEVEL pips
   *  (filled = current level), lit when level > 0. */
  private readonly meleeChip: LevelChip;
  private readonly rangedChip: LevelChip;
  private readonly pierceChip: LevelChip;
  private readonly knockbackChip: LevelChip;
  /** Synergy arc PR1: the first on-hit EFFECT chip (crimson, distinct tier). */
  private readonly lifestealChip: LevelChip;
  /** Synergy arc PR2: the BURN effect chip (ember orange). */
  private readonly burnChip: LevelChip;
  /** Synergy arc PR3: the CHAIN effect chip (electric blue-white). */
  private readonly chainChip: LevelChip;
  /** Synergy arc PR4 (finale): the CRIT effect chip (gold). */
  private readonly critChip: LevelChip;
  /** Meta PR1: the FREEZE effect chip (icy cyan; unlockable — dimmed until earned). */
  private readonly freezeChip: LevelChip;
  private readonly tutorialEl: HTMLDivElement;
  private tutorialState: 'idle' | 'showing' | 'done' = 'idle';
  private tutorialShownAt = 0;
  private readonly minimap: Minimap;

  constructor(container: HTMLElement) {
    this.debug = isDebugEnabled();
    this.minimap = new Minimap(container);

    // Full-screen damage vignette — a red edge-glow over the canvas (below the
    // interactive HUD; pointer-events:none so it never blocks). Opacity is driven
    // each frame from player.hitFlashTimer in update(); 0 (invisible) at rest.
    this.damageVignette = document.createElement('div');
    this.damageVignette.className = 'hud-damage-vignette';
    container.appendChild(this.damageVignette);

    const title = document.createElement('div');
    title.className = 'hud-title';
    title.textContent = 'ROGUE DESCENT';
    title.style.color = CSS_PALETTE.player;
    container.appendChild(title);

    // Depth indicator (under the title) — how far down this run has reached.
    this.depthEl = document.createElement('div');
    this.depthEl.className = 'hud-depth';
    this.depthEl.textContent = 'DEPTH 1';
    container.appendChild(this.depthEl);

    // Combat HUD (always on): labelled health bar + dash-readiness bar.
    const bars = document.createElement('div');
    bars.className = 'hud-bars';
    const makeBar = (label: string, rowMod: string, trackMod: string): HTMLDivElement => {
      const row = document.createElement('div');
      row.className = `hud-bar-row ${rowMod}`;
      const lab = document.createElement('span');
      lab.className = 'hud-bar-label';
      lab.textContent = label;
      const track = document.createElement('div');
      track.className = `hud-bar ${trackMod}`;
      const fill = document.createElement('div');
      fill.className = 'hud-bar-fill';
      track.appendChild(fill);
      row.append(lab, track);
      bars.appendChild(row);
      return fill;
    };
    this.healthFill = makeBar('HEALTH', 'is-health', 'hud-health');

    // Dash is a CHARGE economy, not a single bar: a labelled row of pip segments
    // (one per max charge). Filled pips = available charges; the recharging pip
    // shows partial fill. Build the max possible (DASH.baseCharges + bonus) and
    // show/hide per the player's current cap each frame.
    const dashRow = document.createElement('div');
    dashRow.className = 'hud-bar-row is-dash';
    const dashLabel = document.createElement('span');
    dashLabel.className = 'hud-bar-label';
    dashLabel.textContent = 'DASH';
    const pips = document.createElement('div');
    pips.className = 'hud-dash-pips';
    // Phase 9 PR3: extra-charge is a LEVEL (0..POWERUP_MAX_LEVEL), so build enough
    // pips for the maxed ceiling (base + max level); the per-frame show/hide reveals
    // only dashMaxCharges(player) of them.
    const maxPips = DASH.baseCharges + POWERUP_MAX_LEVEL * DASH.extraChargeBonus;
    for (let i = 0; i < maxPips; i++) {
      const pip = document.createElement('div');
      pip.className = 'hud-dash-pip';
      const fill = document.createElement('div');
      fill.className = 'hud-dash-pip-fill';
      pip.appendChild(fill);
      pips.appendChild(pip);
      this.dashPips.push(pip);
      this.dashPipFills.push(fill);
    }
    dashRow.append(dashLabel, pips);
    bars.appendChild(dashRow);

    // Active-powerup chips (#30, #9 leveled) — always visible so the held build
    // reads at a glance (powerups persist across descent). Dimmed when level 0,
    // lit when held; each carries up to POWERUP_MAX_LEVEL pips (filled = level) so
    // the TIER reads (reusing the dash-pip idiom). Colour = the verb language
    // (melee/knockback orange, ranged/pierce blue).
    const powersRow = document.createElement('div');
    powersRow.className = 'hud-bar-row is-powers hud-powers';
    const makeChip = (text: string, mod: string, color: string): LevelChip => {
      const chip = document.createElement('span');
      chip.className = `hud-chip ${mod}`;
      chip.style.setProperty('--chip-color', color);
      const label = document.createElement('span');
      label.className = 'hud-chip-label';
      label.textContent = text;
      const pipWrap = document.createElement('span');
      pipWrap.className = 'hud-chip-pips';
      const pips: HTMLSpanElement[] = [];
      for (let i = 0; i < POWERUP_MAX_LEVEL; i++) {
        const pip = document.createElement('span');
        pip.className = 'hud-chip-pip';
        pipWrap.appendChild(pip);
        pips.push(pip);
      }
      chip.append(label, pipWrap);
      powersRow.appendChild(chip);
      return { chip, pips };
    };
    this.meleeChip = makeChip('MELEE', 'is-melee', CSS_PALETTE.melee);
    this.rangedChip = makeChip('RANGED', 'is-ranged', CSS_PALETTE.projectile);
    this.pierceChip = makeChip('PIERCE', 'is-pierce', CSS_PALETTE.projectile);
    this.knockbackChip = makeChip('KNOCKBACK', 'is-knockback', CSS_PALETTE.melee);
    // Synergy arc PR1 — LIFESTEAL: the first EFFECT chip, crimson (its own tier vs
    // the orange/blue stat-tracks). As burn/chain/crit join, this row may need a
    // second line / stat-vs-effect grouping — defer that until it actually overflows.
    this.lifestealChip = makeChip('LIFESTEAL', 'is-lifesteal', CSS_PALETTE.lifesteal);
    this.burnChip = makeChip('BURN', 'is-burn', CSS_PALETTE.burn);
    this.chainChip = makeChip('CHAIN', 'is-chain', CSS_PALETTE.chain);
    this.critChip = makeChip('CRIT', 'is-crit', CSS_PALETTE.crit);
    this.freezeChip = makeChip('FREEZE', 'is-freeze', CSS_PALETTE.freeze);
    bars.appendChild(powersRow);

    container.appendChild(bars);

    // One-time dodge tutorial — revealed the first time an enemy telegraphs (the
    // dodge window), so the player learns dash = dodge IN CONTEXT, then it fades.
    this.tutorialEl = document.createElement('div');
    this.tutorialEl.className = 'combat-tutorial';
    this.tutorialEl.textContent = 'DASH through attacks to DODGE';
    container.appendChild(this.tutorialEl);

    // Softlock banner (always created, hidden until the detector fires). It's an
    // on-screen capture surface: when a stall is detected it shows the diagnostic
    // so a plain screenshot carries the data even without devtools open.
    this.softlockBannerEl = document.createElement('div');
    this.softlockBannerEl.className = 'hud-softlock-banner';
    container.appendChild(this.softlockBannerEl);

    // Boss HP bar (Phase 8): top-centre, hidden until a boss is active. A vertical
    // marker at 50% shows the phase-2 escalation threshold (two-phase bosses).
    this.bossWrap = document.createElement('div');
    this.bossWrap.className = 'hud-boss';
    this.bossWrap.style.display = 'none';
    const bossLabel = document.createElement('div');
    bossLabel.className = 'hud-boss-label';
    bossLabel.textContent = 'BOSS';
    const bossTrack = document.createElement('div');
    bossTrack.className = 'hud-boss-track';
    this.bossFill = document.createElement('div');
    this.bossFill.className = 'hud-boss-fill';
    this.bossPhaseMark = document.createElement('div');
    this.bossPhaseMark.className = 'hud-boss-phase-mark';
    bossTrack.append(this.bossFill, this.bossPhaseMark);
    this.bossWrap.append(bossLabel, bossTrack);
    container.appendChild(this.bossWrap);

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

  /** Console trace of the kill->clear sequence (ALWAYS on). Logs each enemy
   *  death (active true->false) and each room flipping to `cleared`, so the lead-
   *  up to a stuck room is reconstructable from the console alone. READ-ONLY. */
  private logTransitions(state: GameState): void {
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (this.prevActive[i] === true && !e.active) {
        console.info(
          `[softlock] enemy #${i} ${e.type} -> dead  hp ${e.health.toFixed(0)} @(${e.x.toFixed(1)},${e.y.toFixed(1)})`,
        );
      }
      this.prevActive[i] = e.active;
    }
    for (let i = 0; i < state.rooms.length; i++) {
      const ph = state.rooms[i].phase;
      if (this.prevPhase[i] !== undefined && this.prevPhase[i] !== ph && ph === 'cleared') {
        console.info(`[softlock] room ${i} -> CLEARED  (activeRoom now ${state.activeRoom})`);
      }
      this.prevPhase[i] = ph;
    }
  }

  /** Reset the stall heuristic + hide the banner (room not a softlock candidate,
   *  or the fight recovered). */
  private resetStall(): void {
    this.stallTimer = 0;
    this.prevHealthSum = Infinity;
    this.prevNearest = Infinity;
    if (this.softlockFired) {
      this.softlockBannerEl.classList.remove('is-visible');
      this.softlockFired = false;
    }
  }

  /**
   * Softlock AUTO-DETECTOR (always on; detection ONLY — never mutates state).
   * Fires when the active room makes no progress for `stallSeconds`: enemy health
   * not dropping, nearest enemy neither engaged nor closing, no enemy attacking,
   * no bolt live. On fire it dumps a console.warn snapshot AND shows the on-screen
   * banner so the failure is captured even without devtools. Heuristic is loose so
   * a normal fight (pursuit / telegraph-strike / kiting) keeps resetting it.
   */
  private detectSoftlock(state: GameState): void {
    const now = state.time;
    const dt = now - this.prevTime;
    this.prevTime = now;

    const ar = state.activeRoom;
    const arEnc = ar >= 0 ? state.rooms[ar] : null;
    // Only an ACTIVE room with live enemies is a softlock candidate.
    if (!arEnc || arEnc.phase !== 'active') {
      this.resetStall();
      return;
    }

    const p = state.player;
    let live = 0;
    let healthSum = 0;
    let nearest = Infinity;
    let anyAttacking = false;
    for (const e of state.enemies) {
      if (!e.active) continue;
      live++;
      healthSum += e.health;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < nearest) nearest = d;
      if (e.phase === 'telegraph' || e.phase === 'strike') anyAttacking = true;
    }
    if (live === 0) {
      this.resetStall();
      return;
    }
    let boltLive = false;
    for (const b of state.enemyProjectiles) if (b.active) boltLive = true;

    // Progress signals (any one resets the stall): the fight is alive.
    const tookDamage = healthSum < this.prevHealthSum - 1e-6;
    const closing = nearest < this.prevNearest - SOFTLOCK_DETECT.approachEpsilon;
    this.prevHealthSum = healthSum;
    this.prevNearest = nearest;
    const engaged = nearest <= SOFTLOCK_DETECT.engageRadius;
    // RESOLVABLE: the nearest live enemy is inside the room rect, so the player
    // can simply walk over and kill it — a kiting/avoidant fight, NOT a softlock.
    // This is the false-positive fix. The detector still FIRES when the nearest
    // live enemy is OUT of the rect (escaped / unreachable) — the real tripwire.
    const resolvable = nearestLiveEnemyInRoom(state.enemies, p.x, p.y, arEnc.rect, state.room.tileSize);

    // Skip discontinuities (floor reset / pause / multiple renders per sim step):
    // only real, forward sim-time deltas accumulate.
    if (dt <= 0 || dt > 1) return;

    if (tookDamage || engaged || closing || anyAttacking || boltLive || resolvable) {
      this.stallTimer = 0;
      if (this.softlockFired) {
        this.softlockBannerEl.classList.remove('is-visible');
        this.softlockFired = false;
      }
      return;
    }

    this.stallTimer += dt;
    if (this.stallTimer >= SOFTLOCK_DETECT.stallSeconds && !this.softlockFired) {
      this.softlockFired = true;
      this.dumpSoftlock(state, ar, arEnc);
    }
  }

  /** Build the diagnostic snapshot, console.warn it, and show the on-screen
   *  banner. The snapshot alone should say WHICH enemy is stuck and WHY (0 hp
   *  but active? out of bounds? frozen velocity? behind a locked door?). */
  private dumpSoftlock(state: GameState, ar: number, arEnc: RoomEncounter): void {
    const p = state.player;
    const ts = state.room.tileSize;
    const r = arEnc.rect;

    const enemyLines: string[] = [];
    let count = 0;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.active) continue;
      count++;
      const tx = Math.floor(e.x / ts);
      const ty = Math.floor(e.y / ts);
      const inside = tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h;
      // Enemy has no vx/vy field — derive per-step velocity from prev position.
      const vx = e.x - e.prevX;
      const vy = e.y - e.prevY;
      const dist = Math.hypot(e.x - p.x, e.y - p.y);
      enemyLines.push(
        `  #${i} ${e.type} active hp ${e.health.toFixed(1)} ` +
          `@(${e.x.toFixed(2)},${e.y.toFixed(2)}) vel(${vx.toFixed(3)},${vy.toFixed(3)}) ` +
          `kb(${e.kbVx.toFixed(2)},${e.kbVy.toFixed(2)}) phase ${e.phase} ` +
          `${inside ? 'IN-ROOM' : 'OUT-OF-ROOM'} dist ${dist.toFixed(2)}`,
      );
    }
    const doors = arEnc.doorCells
      .map((d) => `(${d.tx},${d.ty})${isSolid(state.room, d.tx, d.ty) ? 'SOLID' : 'open'}`)
      .join(' ');

    const snapshot =
      `⚠ SOFTLOCK DETECTED — room ${ar} 'active' with no progress for ` +
      `${SOFTLOCK_DETECT.stallSeconds}s (depth ${state.run.depth}, seed ${state.seed})\n` +
      `player @(${p.x.toFixed(2)},${p.y.toFixed(2)}) health ${p.health.toFixed(0)}\n` +
      `room ${ar} phase ${arEnc.phase} rect x${r.x} y${r.y} w${r.w} h${r.h} ` +
      `planned ${arEnc.spawns.length}\n` +
      `doorCells: ${doors || '(none)'}\n` +
      `activeEnemyCount ${count}\n` +
      (count > 0 ? enemyLines.join('\n') : '  (no live enemies)');

    console.warn(snapshot);

    // On-screen banner: the same data so a screenshot is self-sufficient.
    this.softlockBannerEl.textContent = `${snapshot}\n\n(screenshot this — debug capture)`;
    this.softlockBannerEl.classList.add('is-visible');
  }

  /** Accessibility reduce-motion toggle (driven by main.ts from Settings). Softens the
   *  damage vignette to VIGNETTE.reducedOpacity (kept, as combat info) — shake zeroing is
   *  handled separately in main.ts's render loop. */
  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
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
    controls: Controls,
  ): void {
    const p = state.player;

    // Damage vignette (juice): pulse the red edge-glow from the SAME timer the
    // cube-flash uses (player.hitFlashTimer, set by the sim on damage), so they
    // fade in lockstep. Ratio 1 at the instant of a hit -> 0 when the timer expires.
    const vignettePeak = this.reduceMotion ? VIGNETTE.reducedOpacity : VIGNETTE.peakOpacity;
    const dmg = p.hitFlashTimer > 0 ? (p.hitFlashTimer / PLAYER_COMBAT.hitFlash) * vignettePeak : 0;
    this.damageVignette.style.opacity = dmg.toFixed(3);

    // Combat HUD (always): health fraction + dash charge pips.
    const hp = Math.max(0, p.health) / PLAYER_COMBAT.maxHealth;
    this.healthFill.style.width = `${(hp * 100).toFixed(1)}%`;

    // Dash pips: show `maxCharges` of them; full = available charge, the next pip
    // shows the in-progress recharge, the rest empty.
    const maxCharges = dashMaxCharges(p);
    const rechargeTime = TUNING.dashRecharge * (p.fasterRecharge ? TUNING.dashFasterRechargeFactor : 1);
    const rechargeProg =
      p.dashRechargeTimer > 0 ? 1 - Math.min(1, p.dashRechargeTimer / rechargeTime) : 0;
    for (let i = 0; i < this.dashPips.length; i++) {
      const shown = i < maxCharges;
      this.dashPips[i].style.display = shown ? '' : 'none';
      if (!shown) continue;
      const fill = i < p.dashCharges ? 1 : i === p.dashCharges ? rechargeProg : 0;
      this.dashPipFills[i].style.width = `${(fill * 100).toFixed(1)}%`;
    }

    // Boss HP bar (Phase 8): visible while the boss lives; width = HP fraction.
    // The 50% phase marker shows only for two-phase bosses (the escalation point).
    const boss = state.boss;
    const bossE = boss ? state.enemies[boss.slot] : null;
    if (boss && bossE && bossE.active) {
      this.bossWrap.style.display = '';
      const frac = Math.max(0, bossE.health) / boss.maxHealth;
      this.bossFill.style.width = `${(frac * 100).toFixed(1)}%`;
      this.bossPhaseMark.style.display = boss.phases === 2 ? '' : 'none';
      this.bossWrap.classList.toggle('is-phase2', boss.outerPhase === 2);
    } else {
      this.bossWrap.style.display = 'none';
    }

    // Depth (always): current floor this run.
    this.depthEl.textContent = `DEPTH ${state.run.depth}`;

    // Active powerups (always): lit when held (level > 0), with filled pips = the
    // tier. Persists across descent, so this is the only on-screen build reminder.
    setChipLevel(this.meleeChip, state.player.meleeLevel);
    setChipLevel(this.rangedChip, state.player.rangedLevel);
    setChipLevel(this.pierceChip, state.player.pierceLevel);
    setChipLevel(this.knockbackChip, state.player.knockbackLevel);
    setChipLevel(this.lifestealChip, state.player.lifestealLevel);
    setChipLevel(this.burnChip, state.player.burnLevel);
    setChipLevel(this.chainChip, state.player.chainLevel);
    setChipLevel(this.critChip, state.player.critLevel);
    setChipLevel(this.freezeChip, state.player.freezeLevel);

    // Minimap (always on) — rebuilds itself on floor-change (seed change).
    this.minimap.update(state, alpha);

    this.updateTutorial(state);

    // Softlock instrumentation runs ALWAYS (no ?debug gate) so the intermittent
    // bug is captured live for BOTH players: console kill/clear trace + the
    // auto-detector + on-screen banner. All read-only; no sim effect.
    this.logTransitions(state);
    this.detectSoftlock(state);

    if (!this.readoutEl) return;

    // --- Softlock readout: live enemies + the active room, so a stuck room is
    // legible on-device (which enemy survives, where, what type/health). The
    // active room is the locked one (state.activeRoom); rect/spawns read from it.
    const ts = state.room.tileSize;
    const ar = state.activeRoom;
    const arEnc = ar >= 0 ? state.rooms[ar] : null;
    const arRect = arEnc ? arEnc.rect : null;
    const arPhase = arEnc ? arEnc.phase : 'none';
    const planned = arEnc ? arEnc.spawns.length : 0;
    let activeEnemyCount = 0;
    const enemyLines: string[] = [];
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (!e.active) continue;
      activeEnemyCount++;
      const tx = Math.floor(e.x / ts);
      const ty = Math.floor(e.y / ts);
      const inside = arRect
        ? tx >= arRect.x && tx < arRect.x + arRect.w && ty >= arRect.y && ty < arRect.y + arRect.h
        : false;
      enemyLines.push(
        `  #${i} ${e.type} hp ${e.health.toFixed(0)} @(${e.x.toFixed(1)},${e.y.toFixed(1)}) ${inside ? 'IN' : 'OUT'}`,
      );
    }
    const softlockBlock =
      `SOFTLOCK  activeEnemyCount ${activeEnemyCount}  activeRoom ${ar} phase ${arPhase}  ` +
      `planned ${planned}${planned !== activeEnemyCount && ar >= 0 ? ' (MISMATCH)' : ''}\n` +
      (activeEnemyCount > 0 ? enemyLines.join('\n') + '\n' : '  (no live enemies)\n');
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
    // Phase 7.5 funnel: live enemy mix + ranged bolts in flight.
    let liveChasers = 0;
    let liveRanged = 0;
    for (const e of state.enemies) {
      if (!e.active) continue;
      if (e.type === 'ranged') liveRanged++;
      else liveChasers++;
    }
    let bolts = 0;
    for (const b of state.enemyProjectiles) if (b.active) bolts++;

    this.readoutEl.textContent =
      `fps ${fps.toFixed(0)}   steps ${steps}/f   alpha ${alpha.toFixed(2)}\n` +
      `DESCENT  depth ${state.run.depth}  floorsCleared ${state.run.floorsCleared}  ` +
      `kills ${state.run.kills}\n` +
      `  all-cleared ${cleared === state.rooms.length}  stairs-active ${state.stairs.active}  ` +
      `stairs-room ${state.stairs.roomIndex}\n` +
      `RUN  over ${state.runOver}  time ${state.run.timeSec.toFixed(1)}s  best DEPTH ${loadBest().depth}\n` +
      `DIFFICULTY  enemies/room ${enemiesPerRoomForDepth(state.run.depth)}  ` +
      `ranged/room ${rangedCountForDepth(state.run.depth)}  ` +
      `hp x${healthMultForDepth(state.run.depth).toFixed(2)}  ` +
      `dmg x${damageMultForDepth(state.run.depth).toFixed(2)}  ` +
      `spd x${speedMultForDepth(state.run.depth).toFixed(2)}\n` +
      `ENEMIES  live chaser ${liveChasers}  ranged ${liveRanged}  bolts ${bolts}\n` +
      `floor seed ${state.seed}   (press G to regenerate)\n` +
      `rooms ${cleared}/${state.rooms.length} cleared  active ${state.activeRoom}\n` +
      softlockBlock +
      `powerups  melee L${state.player.meleeLevel}  ranged L${state.player.rangedLevel}  ` +
      `pierce L${state.player.pierceLevel}  knockback L${state.player.knockbackLevel}  ` +
      `xcharge L${state.player.extraChargeLevel}  ` +
      `frecharge ${state.player.fasterRecharge ? 'ON' : 'off'}  ` +
      `dstrike ${state.player.dashStrike ? 'ON' : 'off'}\n` +
      `dash  charges ${state.player.dashCharges}/${dashMaxCharges(state.player)}  ` +
      `recharge ${state.player.dashRechargeTimer.toFixed(2)}s\n` +
      `drops spawned ${spawned} / collected ${collected}` +
      `   (hp ${state.dropCounts.health} · ml ${state.dropCounts.melee} · rn ${state.dropCounts.ranged}` +
      ` · pi ${state.dropCounts.pierce} · kb ${state.dropCounts.knockback}` +
      ` · xc ${state.dropCounts.extraCharge} · fr ${state.dropCounts.fasterRecharge}` +
      ` · ds ${state.dropCounts.dashStrike})\n` +
      `FIRE  aimEngaged ${controls.aimEngaged}  ranged ${intent.ranged}  ` +
      `persist ${controls.firePersistRemainingMs}ms\n` +
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
