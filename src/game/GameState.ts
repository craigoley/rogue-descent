/**
 * The pure game-state container and its single `update` entry point. Owns the
 * player, the room, and the three FIXED-SIZE pools (projectiles, enemies,
 * particles). Imports NOTHING from three and never touches the DOM, so the whole
 * simulation runs and is unit-tested in Node. The rendering layer READS a
 * GameState; it must never mutate one.
 *
 * `update` is the only mutation path and the per-step order of operations:
 *   death/reset -> hit-stop freeze -> player -> attacks -> projectiles ->
 *   enemies -> particles -> shake decay -> death trigger.
 */

import { MELEE, PARTICLE, PLAYER_COMBAT, RANGED, SHAKE, DUNGEON, DESCENT } from '../utils/constants';
import { createPlayer, dashMaxCharges, updatePlayer, type PlayerState } from './Player';
import type { RoomState } from './Room';
import { generateDungeon } from './Dungeon';
import {
  createEnemyPool,
  updateEnemies,
  type Enemy,
} from './Enemy';
import {
  createProjectilePool,
  fireProjectile,
  updateProjectiles,
  type Projectile,
} from './Projectile';
import {
  createParticlePool,
  spawnParticles,
  updateParticles,
  type Particle,
} from './Particle';
import { createPickupPool, updatePickups, type Pickup } from './Pickup';
import {
  buildEncounters,
  rollAndSpawnDrop,
  updateEncounterEntry,
  updateEncounterResolve,
  type RoomEncounter,
} from './Encounter';
import { aimDirection, dashStrike, meleeAttack } from './Combat';
import { createRng, type Rng } from '../utils/rng';
import type { InputIntent } from './Input';
import type { Vec2 } from '../utils/math';

/**
 * Run-level state (Phase 8a). Spans the WHOLE descent — it PERSISTS across a
 * floor change (descend mutates it) and is only reset when a new run begins.
 * loadFloor (a per-floor reset) deliberately does NOT touch this; the new-run
 * reset is Phase 8b's job (permadeath). Keeping it a sub-object makes that seam
 * explicit: "reset the run" = replace `run`, "load a floor" = everything else.
 */
export interface RunState {
  /** Current floor, 1-based. */
  depth: number;
  /** Floors fully cleared + descended this run. */
  floorsCleared: number;
  /** Enemies killed this run. */
  kills: number;
  /** Wall-clock survived this run, seconds. */
  timeSec: number;
}

/** Descent stairs for the CURRENT floor (per-floor; RESET unplaced by loadFloor,
 *  POSITIONED into the last-cleared room by the encounter resolve as rooms clear).
 *  Inactive until every room is cleared, then steppable to descend. */
export interface Stairs {
  /** World position (centre of the LAST-cleared room; (0,0) until first clear). */
  x: number;
  y: number;
  /** Index into rooms[] of the stairs room, or -1 before any room clears. */
  roomIndex: number;
  /** True once every room on the floor is cleared — the exit is open. */
  active: boolean;
}

export interface GameState {
  player: PlayerState;
  room: RoomState;
  /** Run-level state — PERSISTS across descents (see RunState). */
  run: RunState;
  /** Current floor's descent stairs (per-floor; see Stairs). */
  stairs: Stairs;
  /** Player spawn (world units) — centre of the generated floor's spawn room. */
  spawn: { x: number; y: number };
  /** Seed the current floor was generated from. */
  seed: number;
  /** Seconds elapsed in the current life. */
  time: number;
  projectiles: Projectile[];
  enemies: Enemy[];
  particles: Particle[];
  pickups: Pickup[];
  /** Per-room encounter table (DFS order; index 0 = spawn room). */
  rooms: RoomEncounter[];
  /** Index of the currently-active (locked) room, or -1. At most one. */
  activeRoom: number;
  /** Enemy active-flags snapshot from the start of this frame, for death detection. */
  prevEnemyActive: boolean[];
  /** Seeded RNG for drop rolls (separate stream from generation). */
  dropRng: Rng;
  /** Per-kind drop tally for the ?debug funnel (within-run; reset on death). */
  dropCounts: {
    health: number;
    pierce: number;
    knockback: number;
    extraCharge: number;
    fasterRecharge: number;
    dashStrike: number;
  };
  /** Global freeze-frame on impact, seconds. While > 0 the sim is paused. */
  hitstopTimer: number;
  /** Screen-shake countdown, seconds (renderer reads it). */
  shakeTimer: number;
  /** Dead time remaining before the run ends, seconds (the death-pause lead-in). */
  deathTimer: number;
  /** PERMADEATH (Phase 7b): true once the death pause elapses — the run is over
   *  and the sim is frozen, awaiting an explicit startNewRun (the restart). */
  runOver: boolean;
}

/** Reused aim scratch — keeps `update` allocation-free. */
const _aim: Vec2 = { x: 0, y: 0 };

/** Drop RNG seed — a distinct stream from the floor generator. */
const dropSeed = (seed: number): number => (seed + 0x9e3779b9) >>> 0;

export function createGameState(): GameState {
  const state: GameState = {
    player: createPlayer(0, 0),
    room: { tilesX: 0, tilesY: 0, tileSize: 1, walls: [], solid: [] },
    // Run state starts a fresh run; loadFloor below does NOT reset this.
    run: { depth: 1, floorsCleared: 0, kills: 0, timeSec: 0 },
    stairs: { x: 0, y: 0, roomIndex: -1, active: false },
    spawn: { x: 0, y: 0 },
    seed: DUNGEON.defaultSeed,
    time: 0,
    projectiles: createProjectilePool(),
    enemies: createEnemyPool(),
    particles: createParticlePool(),
    pickups: createPickupPool(),
    rooms: [],
    activeRoom: -1,
    prevEnemyActive: [],
    dropRng: createRng(dropSeed(DUNGEON.defaultSeed)),
    dropCounts: { health: 0, pierce: 0, knockback: 0, extraCharge: 0, fasterRecharge: 0, dashStrike: 0 },
    hitstopTimer: 0,
    shakeTimer: 0,
    deathTimer: 0,
    runOver: false,
  };
  state.prevEnemyActive = state.enemies.map((e) => e.active);
  startNewRun(state, DUNGEON.defaultSeed);
  return state;
}

/** Generate the floor for `seed` and (re)initialise everything onto it — a
 *  WITHIN-RUN reset (Phase 6 owns persistence). Pools are REUSED; the powerup
 *  toggles (via createPlayer) and any drops are cleared, so nothing survives. */
function loadFloor(state: GameState, seed: number): void {
  const floor = generateDungeon(seed);
  state.room = floor.room;
  state.spawn = floor.spawn;
  state.seed = seed;
  state.player = createPlayer(floor.spawn.x, floor.spawn.y);
  for (const e of state.enemies) e.active = false;
  for (const p of state.projectiles) p.active = false;
  for (const p of state.particles) p.active = false;
  for (const pk of state.pickups) pk.active = false;
  state.rooms = buildEncounters(floor, state.run.depth); // Phase 7c: depth-scaled spawns
  state.activeRoom = -1;
  // Stairs start UNPLACED + inactive: they're positioned by the encounter resolve
  // as rooms clear (into the LAST-cleared room) and only shown once all rooms are
  // cleared. NOTE: state.run is intentionally NOT touched here (it spans the whole
  // run; Phase 8b owns the new-run reset).
  state.stairs.roomIndex = -1;
  state.stairs.x = 0;
  state.stairs.y = 0;
  state.stairs.active = false;
  state.dropRng = createRng(dropSeed(seed));
  state.dropCounts.health = 0;
  state.dropCounts.pierce = 0;
  state.dropCounts.knockback = 0;
  state.dropCounts.extraCharge = 0;
  state.dropCounts.fasterRecharge = 0;
  state.dropCounts.dashStrike = 0;
  for (let i = 0; i < state.enemies.length; i++) state.prevEnemyActive[i] = false;
  state.hitstopTimer = 0;
  state.shakeTimer = 0;
  state.deathTimer = 0;
  state.time = 0;
}

/**
 * Start a FRESH run (Phase 7b): reset the run-level state, then load floor 1 from
 * `seed`. The ONLY new-run entry — createGameState delegates here and the restart
 * action calls it. loadFloor does the per-floor reset (fresh player via
 * createPlayer => health + powerups cleared; pools + rooms re-armed); here we add
 * the `run` reset + clear runOver that loadFloor deliberately leaves alone. The
 * seed is caller-provided (impure layer) so the sim stays pure/deterministic.
 */
export function startNewRun(state: GameState, seed: number): void {
  state.run.depth = 1;
  state.run.floorsCleared = 0;
  state.run.kills = 0;
  state.run.timeSec = 0;
  state.runOver = false;
  loadFloor(state, seed);
}

/** Deterministic next-floor seed from the current seed + the (new) depth. Pure +
 *  exported so the descent is reproducible and unit-testable. 32-bit via imul. */
export function nextFloorSeed(seed: number, depth: number): number {
  return (seed + Math.imul(DESCENT.seedStride, depth)) >>> 0;
}

/** Refresh stairs.active from the all-cleared signal and, if the player is on the
 *  open stairs, DESCEND: bump run depth/floorsCleared and load the next floor.
 *  Returns true if a descent happened (caller should end the frame). */
function descendIfReady(state: GameState): boolean {
  const stairs = state.stairs;
  // All-cleared is monotonic (cleared is terminal), so this just tracks progress.
  // For-loop (not .every()) to avoid per-frame closure allocation.
  let allCleared = true;
  for (let i = 0; i < state.rooms.length; i++) {
    if (state.rooms[i].phase !== 'cleared') { allCleared = false; break; }
  }
  stairs.active = allCleared;
  if (!stairs.active) return false;
  const p = state.player;
  if (Math.hypot(p.x - stairs.x, p.y - stairs.y) > DESCENT.contactRadius) return false;
  // Descend: run state PERSISTS (mutated, not reset) across the floor change.
  state.run.depth += 1;
  state.run.floorsCleared += 1;
  // Descent COMPOUNDS the build: carry the within-run powerups + current health
  // to the next floor so descending feels like GROWTH, not a wipe. Captured BY
  // VALUE before loadFloor (which swaps in a fresh createPlayer at the new spawn)
  // and re-applied after. Only DEATH / new-run reset these — via the untouched
  // loadFloor→createPlayer path in startNewRun. Position is NOT carried: the
  // player still moves to the new floor's spawn point.
  const carried = {
    pierce: p.pierce,
    meleeKnockback: p.meleeKnockback,
    extraCharge: p.extraCharge,
    fasterRecharge: p.fasterRecharge,
    dashStrike: p.dashStrike,
    health: p.health,
  };
  loadFloor(state, nextFloorSeed(state.seed, state.run.depth));
  state.player.pierce = carried.pierce;
  state.player.meleeKnockback = carried.meleeKnockback;
  state.player.extraCharge = carried.extraCharge;
  state.player.fasterRecharge = carried.fasterRecharge;
  state.player.dashStrike = carried.dashStrike;
  state.player.health = carried.health;
  // Arrive on the new floor with dash FULL (charges reflect the carried cap).
  state.player.dashCharges = dashMaxCharges(state.player);
  return true;
}

/** Regenerate the floor with a new seed (debug "cycle floors" affordance). */
export function regenerate(state: GameState, seed: number): void {
  loadFloor(state, seed);
}

export function update(state: GameState, intent: InputIntent, dt: number): void {
  const p = state.player;

  // Dead: the death pause plays the death particles/shake as a lead-in, then the
  // RUN ENDS (permadeath). The sim stays frozen at runOver — no same-floor
  // respawn — until an explicit startNewRun (the restart action) begins a fresh run.
  if (!p.alive) {
    if (state.deathTimer > 0) {
      state.deathTimer -= dt;
      if (state.deathTimer <= 0) state.runOver = true;
    }
    return;
  }

  // Hit-stop: pause the entire sim for a few ms to sell the impact.
  if (state.hitstopTimer > 0) {
    state.hitstopTimer -= dt;
    return;
  }

  state.time += dt;
  state.run.timeSec += dt; // run-level survival clock (persists across descents)

  // Snapshot enemy liveness BEFORE this frame's deaths (for drop detection).
  for (let i = 0; i < state.enemies.length; i++) state.prevEnemyActive[i] = state.enemies[i].active;

  updatePlayer(p, intent, dt, state.room);

  // Dash-strike: a damaging dash hits enemies it sweeps through (once each). Runs
  // on the freshly-moved player, BEFORE the death-diff below, so its kills count +
  // roll drops like any other.
  if (p.dashTimer > 0 && p.dashStrike) dashStrike(state);

  // Encounter: entering an idle room activates it (spawns enemies + locks doors).
  updateEncounterEntry(state);

  // Melee — edge-triggered, consumed here.
  if (intent.melee) {
    intent.melee = false;
    if (p.meleeCdTimer <= 0) {
      const aim = aimDirection(p, intent, _aim);
      meleeAttack(state, aim.x, aim.y);
      p.meleeCdTimer = MELEE.cooldown;
      p.meleeAnimTimer = MELEE.active;
    }
  }

  // Ranged — held; fires at the weapon cooldown. (The PIERCE powerup changes
  // what a shot DOES, not how fast it fires — fire rate is fixed.)
  if (intent.ranged && p.rangedCdTimer <= 0) {
    const aim = aimDirection(p, intent, _aim);
    fireProjectile(state.projectiles, p.x, p.y, aim.x, aim.y);
    p.rangedCdTimer = RANGED.cooldown;
  }

  updateProjectiles(state, dt);
  updateEnemies(state, dt);

  // Deaths this frame -> run kill tally + seeded drop rolls at the death positions.
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (state.prevEnemyActive[i] && !e.active) {
      state.run.kills += 1;
      rollAndSpawnDrop(state, e.x, e.y, state.dropRng);
    }
  }
  // Clear the active room if its enemies are all dead -> unlock doors.
  updateEncounterResolve(state);
  // Collect any pickup the player is touching.
  updatePickups(state);

  // Descent: once every room is cleared the stairs open; stepping on them loads
  // the next floor. On descend the state is rebuilt, so end the frame here.
  if (descendIfReady(state)) return;

  updateParticles(state.particles, dt);

  if (state.shakeTimer > 0) state.shakeTimer -= dt;

  // Death trigger.
  if (p.health <= 0) {
    p.alive = false;
    p.health = 0;
    state.deathTimer = PLAYER_COMBAT.deathPause;
    spawnParticles(state.particles, p.x, p.y, PARTICLE.deathCount);
    state.shakeTimer = SHAKE.duration;
  }
}
