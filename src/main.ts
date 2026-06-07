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
import { playerRoomIndex } from './game/Encounter';
import { Controls } from './input/Controls';
import { SceneManager } from './rendering/SceneManager';
import { DungeonRenderer } from './rendering/DungeonRenderer';
import { EntityRenderer } from './rendering/EntityRenderer';
import { HUD, isDebugEnabled } from './rendering/HUD';
import { RunSummary } from './rendering/RunSummary';
import { AudioEngine } from './audio/AudioEngine';
import { AudioManager } from './audio/AudioManager';
import { loadSettings, saveSettings, type Settings } from './state/Settings';
import { DASH, MAX_FRAME_DT, SHAKE, SIM_DT, TUNING } from './utils/constants';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app container not found');

// --- State (pure) ---------------------------------------------------------
const game = createGameState();

// E2E / screenshot SEAM (entry-layer only — src/game/ stays pure). Deterministic
// boot scenes from URL params so Playwright (L2) can baseline stable frames:
//   ?seed=<n>     regenerate floor 1 from that seed (the sim already takes a seed;
//                 we just pass the URL one — same as startNewRun does on restart).
//   ?scene=boss   position the player on the boss room's body floor so the first
//                 sim step activates it + spawns the boss (a stable boss baseline).
//   ?still=1      freeze on the first painted frame (halt the rAF loop) so an
//                 always-animating WebGL canvas yields a deterministic screenshot.
// Reads/writes only `game` at boot (the orchestration layer already owns seed +
// restart setup); no renderer mutates state in the loop.
const bootParams = new URLSearchParams(window.location.search);
const seedParam = bootParams.get('seed');
if (seedParam !== null && /^\d+$/.test(seedParam)) startNewRun(game, Number(seedParam) >>> 0);
if (bootParams.get('scene') === 'boss') {
  const rect = game.rooms[game.bossRoom]?.rect;
  if (rect) {
    const room = game.room;
    let placed = false;
    for (let ty = rect.y; ty < rect.y + rect.h && !placed; ty++) {
      for (let tx = rect.x; tx < rect.x + rect.w && !placed; tx++) {
        if (room.corridor?.[ty * room.tilesX + tx]) continue; // body floor, not a corridor strip
        game.player.x = (tx + 0.5) * room.tileSize;
        game.player.y = (ty + 0.5) * room.tileSize;
        placed = true;
      }
    }
  }
}
const stillMode = bootParams.get('still') === '1';
let firstFramePainted = false;

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

// SETTINGS surface: a single gear button opens a small panel with clearly-labelled
// Sound + Reduce Motion toggles — decluttering the play HUD (was two bare, ambiguous
// "SOUND" / "MOTION ON" buttons). Non-pausing (the game has no pause; this is a light
// toggle panel). The values already persist (#64 Settings); this only relocates +
// relabels their controls. Render/state only — the sim is unaware.
hud.setReduceMotion(settings.reduceMotion); // apply the persisted setting at startup

const settingsBtn = document.createElement('button');
settingsBtn.className = 'hud-settings-btn';
settingsBtn.textContent = '⚙';
settingsBtn.setAttribute('aria-label', 'Settings');
app.appendChild(settingsBtn);

const settingsPanel = document.createElement('div');
settingsPanel.className = 'hud-settings-panel';
app.appendChild(settingsPanel);

const heading = document.createElement('div');
heading.className = 'hud-settings-heading';
heading.textContent = 'SETTINGS';
settingsPanel.appendChild(heading);

// Sound row (clear "Sound: On/Off" — sound ON = not muted). M key shares the toggle.
const soundRow = document.createElement('button');
soundRow.className = 'hud-settings-row';
settingsPanel.appendChild(soundRow);
const refreshSound = (): void => {
  soundRow.textContent = `Sound: ${settings.muted ? 'Off' : 'On'}`;
  soundRow.classList.toggle('is-off', settings.muted);
};
const toggleMute = (): void => {
  settings.muted = !settings.muted;
  audio.setMuted(settings.muted);
  audioMgr.setMuted(settings.muted);
  saveSettings(settings);
  refreshSound();
};
refreshSound();
soundRow.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  toggleMute();
});

// Reduce-motion row (clear "Reduce Motion: On/Off"). ON => zero camera shake (render
// loop below) + softened damage vignette (kept as combat info). Behaviour unchanged.
const motionRow = document.createElement('button');
motionRow.className = 'hud-settings-row';
settingsPanel.appendChild(motionRow);
const refreshMotion = (): void => {
  motionRow.textContent = `Reduce Motion: ${settings.reduceMotion ? 'On' : 'Off'}`;
  motionRow.classList.toggle('is-off', !settings.reduceMotion);
};
refreshMotion();
motionRow.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  settings.reduceMotion = !settings.reduceMotion;
  hud.setReduceMotion(settings.reduceMotion);
  saveSettings(settings);
  refreshMotion();
});

// Gear toggles the panel open/closed.
settingsBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  settingsPanel.classList.toggle('is-open');
  settingsBtn.classList.toggle('is-open');
});

// M key keeps the quick mute shortcut (desktop), routed through the same toggle.
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'm') return;
  toggleMute();
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

// Per-sim-step PLAYER POSITION TRACE (?debug only) — diagnoses the "teleport".
// It distinguishes a CONTINUOUS shove (mechanism (c): a corridor carved through a
// room rect flips playerRoomIndex mid-corridor → wrong-room activation → door-lock
// pushes the player out via the normal resolveX/Y, so Δ stays bounded) from a
// single-step JUMP (Δ ≫ the max legit per-tick move = a position write we missed).
// SMOKING GUN for (c): playerRoomIndex CHANGES while Δ stays continuous (no ⚠JUMP).
// Read-only on game state; logged ON the sim step so Δ is per-tick. Zero effect
// when ?debug is off.
const DASH_SPEED = TUNING.dashDist / DASH.duration;
// Max legit per-tick move includes DASH (faster than maxSpeed), so a dash doesn't
// false-flag; a real room-jump (rooms are >= 6 tiles apart) is far beyond 2x this.
const TRACE_STEP_MAX = Math.max(TUNING.maxSpeed, DASH_SPEED) * SIM_DT;
const TRACE_JUMP = TRACE_STEP_MAX * 2;
let traceX = game.player.x;
let traceY = game.player.y;
let tracePrevRoom = -2; // sentinel: forces the first line
function tracePlayer(): void {
  const p = game.player;
  const dx = p.x - traceX;
  const dy = p.y - traceY;
  const d = Math.hypot(dx, dy);
  traceX = p.x;
  traceY = p.y;
  const room = playerRoomIndex(game);
  const roomChanged = room !== tracePrevRoom;
  // Log only on movement or a room-identity change (skip idle to avoid spam).
  if (d < 1e-4 && !roomChanged) return;
  tracePrevRoom = room;
  const flag = d > TRACE_JUMP ? '⚠JUMP ' : '';
  console.info(
    `${flag}[pos] (${p.x.toFixed(3)},${p.y.toFixed(3)}) Δ${d.toFixed(3)}` +
      `${roomChanged ? ' ROOM→' : ' room '}${room} active ${game.activeRoom}` +
      ` seed ${game.seed} depth ${game.run.depth}  (maxΔ≈${TRACE_STEP_MAX.toFixed(3)})`,
  );
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
    if (debug) tracePlayer(); // per-tick position trace (teleport diagnosis)
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
  // Reduce-motion zeroes camera shake (the motion/nausea source); the sim still
  // sets shakeTimer as always — only the render interpretation changes.
  const shake =
    settings.reduceMotion || game.shakeTimer <= 0
      ? 0
      : (game.shakeTimer / SHAKE.duration) * TUNING.shake;
  scene.setShake(shake);
  entities.sync(game, alpha, controls.intent);
  audioMgr.sync(game); // diff state -> play combat SFX (side-effect only)
  scene.updateFollow(game, alpha, dt);
  scene.render();
  hud.update(game, fps, steps, alpha, controls.intent, scene, controls);
  summary.update(game);
  if (debug) logEncounters();

  // E2E readiness: flag the first painted frame so Playwright can wait on a
  // deterministic state instead of a sleep. In ?still mode, halt here (one frame
  // painted) so the WebGL canvas is frozen for a stable screenshot baseline.
  if (!firstFramePainted) {
    firstFramePainted = true;
    document.body.dataset.ready = '1';
    if (stillMode) return; // freeze on frame 1 — do not schedule the next frame
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
