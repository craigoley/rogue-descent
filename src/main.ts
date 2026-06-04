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
import { createGameState, regenerate, startNewRun, update } from './game/GameState';
import { generateDungeon, isConnected } from './game/Dungeon';
import { Controls } from './input/Controls';
import { SceneManager } from './rendering/SceneManager';
import { DungeonRenderer } from './rendering/DungeonRenderer';
import { EntityRenderer } from './rendering/EntityRenderer';
import { HUD, isDebugEnabled } from './rendering/HUD';
import { RunSummary } from './rendering/RunSummary';
import { AudioEngine } from './audio/AudioEngine';
import { AudioManager } from './audio/AudioManager';
import { loadSettings, saveSettings, type Settings } from './state/Settings';
import { MAX_FRAME_DT, SHAKE, SIM_DT, TUNING } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container not found');

// --- State (pure) ---------------------------------------------------------
const game = createGameState();
const settings: Settings = loadSettings();

// --- Adapters & rendering (impure; read state) ----------------------------
const controls = new Controls(app);
const scene = new SceneManager(app);
const dungeon = new DungeonRenderer(scene.scene);
dungeon.build(game.room);
const entities = new EntityRenderer(scene.scene);
const hud = new HUD(app);

// Fresh per-run seed (impure — keeps the sim pure). The counter guarantees
// distinct seeds even on rapid restarts within the same millisecond.
let runSeedCounter = 0;
const freshRunSeed = (): number => (Date.now() + Math.imul(++runSeedCounter, 0x9e3779b9)) >>> 0;

// Run-over overlay: one-tap/-click/-key RESTART starts a FRESH run. The loop's
// seed-change rebuild (below) picks up the new floor; we just mutate state here.
const summary = new RunSummary(app, () => startNewRun(game, freshRunSeed()));

// Start the camera framed on the player's spawn — no slide-in on frame 1.
scene.snapFocus(game.spawn.x, game.spawn.y);
let builtSeed = game.seed; // last floor the DungeonRenderer was built for

// Funnel telemetry: log floor stats on generation (room count + connectivity).
function logFloor(seed: number): void {
  const f = generateDungeon(seed);
  console.info(`[dungeon] seed=${seed} rooms=${f.rooms.length} connected=${isConnected(f)}`);
}
logFloor(game.seed);

// ?debug=1: press G to regenerate the floor with the next seed (cycle floors).
// The loop's seed-change rebuild handles dungeon.build + snapFocus + logFloor.
if (isDebugEnabled()) {
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'g') return;
    regenerate(game, game.seed + 1);
  });
}

// Audio context is created now but only resumed after a user gesture.
const audio = new AudioEngine();
audio.init();
// Combat-core SFX: a sibling to EntityRenderer — diffs game state each frame and
// plays a sound on an observable state change (hit/death/shoot/etc.). Reads
// state, writes only sound; never mutates the sim.
const audioMgr = new AudioManager(audio, game);
// Apply the persisted mute setting at startup (was previously discarded).
audio.setMuted(settings.muted);
audioMgr.setMuted(settings.muted);
const unlockAudio = (): void => {
  void audio.resume();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// M toggles master mute; persisted (Safari-Private-safe via saveSettings).
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'm') return;
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  audioMgr.setMuted(settings.muted);
  saveSettings(settings);
});

// Phase 5 funnel telemetry (?debug only): log room lifecycle + drop transitions.
const debug = isDebugEnabled();
const prevPhase: string[] = [];
let prevSpawned = 0;
let prevCollected = 0;
function logEncounters(): void {
  for (let i = 0; i < game.rooms.length; i++) {
    const ph = game.rooms[i].phase;
    if (prevPhase[i] !== ph) {
      const tag = ph === 'active' ? ' (doors LOCKED)' : ph === 'cleared' ? ' (doors unlocked)' : '';
      console.info(`[encounter] room ${i} -> ${ph}${tag}`);
      prevPhase[i] = ph;
    }
  }
  let spawned = 0;
  let collected = 0;
  for (const r of game.rooms) {
    spawned += r.dropsSpawned;
    collected += r.dropsCollected;
  }
  if (spawned !== prevSpawned) {
    console.info(`[drop] spawned total ${spawned}`);
    prevSpawned = spawned;
  }
  if (collected !== prevCollected) {
    console.info(`[drop] collected total ${collected}`);
    prevCollected = collected;
  }
}

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

  // Phase 6.6 touch auto-fire: tick the aim-engaged fire-persistence window with
  // the real frame dt (touch only; desktop fire is event-driven and untouched).
  controls.tickFire(dt);

  // Step the sim in fixed slices; count steps for the debug readout.
  accumulator += dt;
  let steps = 0;
  while (accumulator >= SIM_DT) {
    update(game, controls.intent, SIM_DT);
    accumulator -= SIM_DT;
    steps++;
  }
  const alpha = accumulator / SIM_DT;

  // Floor changed (descent OR a fresh-run restart, both via loadFloor's new seed)
  // -> rebuild the 3D floor + re-frame the camera. Single rebuild authority for
  // every floor transition (also closes the 8a gap where descent didn't rebuild).
  if (game.seed !== builtSeed) {
    dungeon.build(game.room);
    scene.snapFocus(game.spawn.x, game.spawn.y);
    logFloor(game.seed);
    builtSeed = game.seed;
  }

  // Render the interpolated state. Renderers read prev+current; never mutate.
  const shake = game.shakeTimer > 0 ? (game.shakeTimer / SHAKE.duration) * TUNING.shake : 0;
  scene.setShake(shake);
  entities.sync(game, alpha, controls.intent);
  audioMgr.sync(game); // diff state -> play combat SFX (side-effect only)
  scene.updateFollow(game, alpha, dt);
  scene.render();
  hud.update(game, fps, steps, alpha, controls.intent, scene, controls);
  summary.update(game);
  if (debug) logEncounters();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
