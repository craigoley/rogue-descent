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

import { MELEE, PARTICLE, PLAYER_COMBAT, RANGED, SHAKE, DUNGEON } from '../utils/constants';
import { createPlayer, updatePlayer, type PlayerState } from './Player';
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
import { aimDirection, meleeAttack } from './Combat';
import { createRng, type Rng } from '../utils/rng';
import type { InputIntent } from './Input';
import type { Vec2 } from '../utils/math';

export interface GameState {
  player: PlayerState;
  room: RoomState;
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
  dropCounts: { health: number; pierce: number; knockback: number };
  /** Global freeze-frame on impact, seconds. While > 0 the sim is paused. */
  hitstopTimer: number;
  /** Screen-shake countdown, seconds (renderer reads it). */
  shakeTimer: number;
  /** Dead time remaining before the room auto-resets, seconds. */
  deathTimer: number;
}

/** Reused aim scratch — keeps `update` allocation-free. */
const _aim: Vec2 = { x: 0, y: 0 };

/** Drop RNG seed — a distinct stream from the floor generator. */
const dropSeed = (seed: number): number => (seed + 0x9e3779b9) >>> 0;

export function createGameState(): GameState {
  const state: GameState = {
    player: createPlayer(0, 0),
    room: { tilesX: 0, tilesY: 0, tileSize: 1, walls: [], solid: [] },
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
    dropCounts: { health: 0, pierce: 0, knockback: 0 },
    hitstopTimer: 0,
    shakeTimer: 0,
    deathTimer: 0,
  };
  state.prevEnemyActive = state.enemies.map((e) => e.active);
  loadFloor(state, DUNGEON.defaultSeed);
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
  state.rooms = buildEncounters(floor);
  state.activeRoom = -1;
  state.dropRng = createRng(dropSeed(seed));
  state.dropCounts.health = 0;
  state.dropCounts.pierce = 0;
  state.dropCounts.knockback = 0;
  for (let i = 0; i < state.enemies.length; i++) state.prevEnemyActive[i] = false;
  state.hitstopTimer = 0;
  state.shakeTimer = 0;
  state.deathTimer = 0;
  state.time = 0;
}

/** Reset for a fresh attempt on the SAME floor (Phase 5 owns run structure). */
export function resetRun(state: GameState): void {
  loadFloor(state, state.seed);
}

/** Regenerate the floor with a new seed (debug "cycle floors" affordance). */
export function regenerate(state: GameState, seed: number): void {
  loadFloor(state, seed);
}

export function update(state: GameState, intent: InputIntent, dt: number): void {
  const p = state.player;

  // Dead: freeze the sim, count down, then reset the room.
  if (!p.alive) {
    state.deathTimer -= dt;
    if (state.deathTimer <= 0) resetRun(state);
    return;
  }

  // Hit-stop: pause the entire sim for a few ms to sell the impact.
  if (state.hitstopTimer > 0) {
    state.hitstopTimer -= dt;
    return;
  }

  state.time += dt;

  // Snapshot enemy liveness BEFORE this frame's deaths (for drop detection).
  for (let i = 0; i < state.enemies.length; i++) state.prevEnemyActive[i] = state.enemies[i].active;

  updatePlayer(p, intent, dt, state.room);

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

  // Deaths this frame -> seeded drop rolls at the death positions.
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (state.prevEnemyActive[i] && !e.active) rollAndSpawnDrop(state, e.x, e.y, state.dropRng);
  }
  // Clear the active room if its enemies are all dead -> unlock doors.
  updateEncounterResolve(state);
  // Collect any pickup the player is touching.
  updatePickups(state);

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
