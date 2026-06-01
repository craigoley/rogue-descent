/**
 * Entry point + the fixed-timestep game loop.
 *
 * The loop is the contract every later phase builds on:
 *
 *     gather input  ->  update(state, intent, dt)  ->  render(state)  ->  repeat
 *
 * Simulation advances in fixed TIMESTEP increments off an accumulator, so the
 * game logic is deterministic and frame-rate independent; rendering happens once
 * per animation frame and only READS state. The player moves because
 * GameState.update mutates PlayerState — never because input is wired straight
 * into this loop.
 */

import './style.css';
import { createGameState, update } from './game/GameState';
import { Controls } from './input/Controls';
import { SceneManager } from './rendering/SceneManager';
import { DungeonRenderer } from './rendering/DungeonRenderer';
import { EntityRenderer } from './rendering/EntityRenderer';
import { HUD } from './rendering/HUD';
import { AudioEngine } from './audio/AudioEngine';
import { loadSettings } from './state/Settings';
import { MAX_FRAME_DT, TIMESTEP } from './utils/constants';

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

// Frame the camera on the room centre.
scene.lookAt(
  (game.room.tilesX * game.room.tileSize) / 2,
  (game.room.tilesY * game.room.tileSize) / 2,
);

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
  // Smoothed FPS for the debug overlay (avoids per-frame allocation).
  fps = fps === 0 ? 1 / dt : fps * 0.9 + (1 / dt) * 0.1;

  accumulator += dt;
  while (accumulator >= TIMESTEP) {
    update(game, controls.intent, TIMESTEP);
    accumulator -= TIMESTEP;
  }

  entities.sync(game);
  scene.render();
  hud.update(game, fps);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
