/**
 * Entry point + the fixed-timestep game loop with render interpolation.
 *
 *   gather input -> step sim in fixed SIM_DT slices -> render(interpolated)
 *
 * Real frame time is accumulated and the sim is advanced in whole SIM_DT steps;
 * the leftover remainder becomes `alpha` (0..1), and the renderers lerp each
 * entity between its previous and current sim-step position by that alpha. So
 * the simulation stays deterministic and frame-rate independent while motion
 * looks smooth at 60 or 120 Hz. The player moves because GameState.update
 * mutates PlayerState — never because input is wired straight into this loop.
 */

import './style.css';
import { createGameState, update } from './game/GameState';
import { roomCenter } from './game/Room';
import { Controls } from './input/Controls';
import { SceneManager } from './rendering/SceneManager';
import { DungeonRenderer } from './rendering/DungeonRenderer';
import { EntityRenderer } from './rendering/EntityRenderer';
import { HUD } from './rendering/HUD';
import { AudioEngine } from './audio/AudioEngine';
import { loadSettings } from './state/Settings';
import { MAX_FRAME_DT, SHAKE, SIM_DT, TUNING } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container not found');

// --- State (pure) ---------------------------------------------------------
const game = createGameState();
loadSettings();

// --- Adapters & rendering (impure; read state) ----------------------------
const controls = new Controls(app);
const scene = new SceneManager(app);
const dungeon = new DungeonRenderer(scene.scene);
dungeon.build(game.room);
const entities = new EntityRenderer(scene.scene);
const hud = new HUD(app);

// Start the camera framed on the player (room centre) — no slide-in on frame 1.
const center = roomCenter(game.room);
scene.snapFocus(center.x, center.y);

// Audio context is created now but only resumed after a user gesture.
const audio = new AudioEngine();
audio.init();
const unlockAudio = (): void => {
  void audio.resume();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// --- Loop -----------------------------------------------------------------
let lastMs = performance.now();
let accumulator = 0;
let fps = 0;

function frame(nowMs: number): void {
  let dt = (nowMs - lastMs) / 1000;
  lastMs = nowMs;
  dt = Math.min(dt, MAX_FRAME_DT);
  // Smoothed FPS for the debug overlay (no per-frame allocation).
  fps = fps === 0 ? 1 / dt : fps * 0.9 + (1 / dt) * 0.1;

  // Desktop mouse-aim: aim from the player's screen position toward the cursor.
  // (On touch there's no mouse, so the aim stick's value is left untouched.)
  if (controls.hasMouse) {
    const sp = scene.worldToScreenPx(game.player.x, game.player.y);
    const ax = controls.mouseX - sp.x;
    const ay = controls.mouseY - sp.y;
    const len = Math.hypot(ax, ay);
    if (len > 0.0001) {
      controls.intent.aimX = ax / len;
      controls.intent.aimY = ay / len;
    }
  }

  // Step the sim in fixed slices; count steps for the debug readout.
  accumulator += dt;
  let steps = 0;
  while (accumulator >= SIM_DT) {
    update(game, controls.intent, SIM_DT);
    accumulator -= SIM_DT;
    steps++;
  }
  const alpha = accumulator / SIM_DT;

  // Render the interpolated state. Renderers read prev+current; never mutate.
  const shake = game.shakeTimer > 0 ? (game.shakeTimer / SHAKE.duration) * TUNING.shake : 0;
  scene.setShake(shake);
  entities.sync(game, alpha, controls.intent);
  scene.updateFollow(game, alpha, dt);
  scene.render();
  hud.update(game, fps, steps, alpha, controls.intent, scene);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
