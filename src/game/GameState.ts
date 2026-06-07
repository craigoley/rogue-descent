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

import { BOSS, MELEE, PARTICLE, PLAYER_COMBAT, RANGED, SHAKE, DUNGEON, DESCENT } from '../utils/constants';
import { createPlayer, dashMaxCharges, updatePlayer, type PlayerState } from './Player';
import type { RoomState } from './Room';
import { generateDungeon } from './Dungeon';
import {
  createEnemyPool,
  spawnEnemy,
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
  createEnemyProjectilePool,
  updateEnemyProjectiles,
  type EnemyProjectile,
} from './EnemyProjectile';
import {
  createParticlePool,
  spawnParticles,
  updateParticles,
  type Particle,
} from './Particle';
import { createChainArcPool, updateChainArcs, type ChainArc } from './ChainArc';
import { createPickupPool, updatePickups, type Pickup } from './Pickup';
import {
  buildEncounters,
  rollAndSpawnDrop,
  updateEncounterEntry,
  updateEncounterDoors,
  updateEncounterResolve,
  type RoomEncounter,
} from './Encounter';
import { aimDirection, dashStrike, meleeAttack } from './Combat';
import { createRng, type Rng } from '../utils/rng';
import type { InputIntent } from './Input';
import type { Vec2 } from '../utils/math';
import type { BossState } from './Boss';

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
 *  PINNED to the boss room by the encounter resolve on its clear — see #44).
 *  Inactive until the floor's BOSS is dead (Phase 8), then steppable to descend. */
export interface Stairs {
  /** World position (centre of the boss room; (0,0) until first placed). */
  x: number;
  y: number;
  /** Index into rooms[] of the stairs room, or -1 before any room clears. */
  roomIndex: number;
  /** True once this floor's BOSS is defeated (bossDefeated) — the exit is open.
   *  (Was "every room cleared"; side rooms are optional as of Phase 8.) */
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
  /** Ranged-enemy bolts in flight (separate pool from the player's projectiles). */
  enemyProjectiles: EnemyProjectile[];
  particles: Particle[];
  /** Chain-arc bolts (synergy arc PR3) — cosmetic-in-sim like particles; the chain
   *  loop records segments, the renderer draws + fades them. */
  chainArcs: ChainArc[];
  pickups: Pickup[];
  /** Per-room encounter table (DFS order; index 0 = spawn room). */
  rooms: RoomEncounter[];
  /** Index of the currently-active (locked) room, or -1. At most one. */
  activeRoom: number;
  /** Index into rooms[] of this floor's BOSS room (Phase 8) — set per-floor from
   *  the generated Floor.bossRoom. The boss spawns when this room activates and
   *  gates descent (stairs pin here). */
  bossRoom: number;
  /** Companion state for the live boss (Phase 8), or null when no boss is active
   *  (between floors, or before the boss room activates / after the boss dies).
   *  The boss itself is a pooled Enemy; this holds its rich phase/gimmick state. */
  boss: BossState | null;
  /** Durable per-floor flag: true once THIS floor's boss has been killed. The
   *  boss is the floor's descent gate (Phase 8) — stairs unlock on boss death,
   *  not on every room being cleared (side rooms are optional). Distinct from
   *  `boss === null`, which is ALSO true before the boss spawns; this only flips
   *  true on death and resets in loadFloor. */
  bossDefeated: boolean;
  /** Enemy active-flags snapshot from the start of this frame, for death detection. */
  prevEnemyActive: boolean[];
  /** Seeded RNG for drop rolls (separate stream from generation). */
  dropRng: Rng;
  /** Seeded RNG for COMBAT rolls — crit (synergy arc PR4). A stream INDEPENDENT of
   *  dropRng (distinct seed offset), so adding crit can't shift drop sequences; only
   *  drawn when critLevel > 0, so default runs / existing tests are byte-identical.
   *  Reseeded per floor like dropRng (the determinism discipline). */
  combatRng: Rng;
  /** Per-kind drop tally for the ?debug funnel (within-run; reset on death). */
  dropCounts: {
    health: number;
    melee: number;
    ranged: number;
    pierce: number;
    knockback: number;
    extraCharge: number;
    fasterRecharge: number;
    dashStrike: number;
    lifesteal: number;
    burn: number;
    chain: number;
    crit: number;
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
/** Combat-rng seed: a DISTINCT offset from dropSeed so the crit stream is independent
 *  of the drop stream (adding crit never perturbs drop sequences). */
const combatSeed = (seed: number): number => (seed + 0x85ebca6b) >>> 0;

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
    enemyProjectiles: createEnemyProjectilePool(),
    particles: createParticlePool(),
    chainArcs: createChainArcPool(),
    pickups: createPickupPool(),
    rooms: [],
    activeRoom: -1,
    bossRoom: -1,
    boss: null,
    bossDefeated: false,
    prevEnemyActive: [],
    dropRng: createRng(dropSeed(DUNGEON.defaultSeed)),
    combatRng: createRng(combatSeed(DUNGEON.defaultSeed)),
    dropCounts: { health: 0, melee: 0, ranged: 0, pierce: 0, knockback: 0, extraCharge: 0, fasterRecharge: 0, dashStrike: 0, lifesteal: 0, burn: 0, chain: 0, crit: 0 },
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
  for (const p of state.enemyProjectiles) p.active = false;
  for (const p of state.particles) p.active = false;
  for (const a of state.chainArcs) a.active = false;
  for (const pk of state.pickups) pk.active = false;
  state.rooms = buildEncounters(floor, state.run.depth); // Phase 7c: depth-scaled spawns
  state.activeRoom = -1;
  state.bossRoom = floor.bossRoom; // Phase 8: boss room for this floor
  state.boss = null; // no boss until its room activates
  state.bossDefeated = false; // this floor's boss must be killed to unlock descent
  // Stairs start UNPLACED + inactive: PINNED to the boss room by the encounter
  // resolve on its clear, and only shown once the boss is dead (bossDefeated).
  // NOTE: state.run is intentionally NOT touched here (it spans the whole
  // run; Phase 8b owns the new-run reset).
  state.stairs.roomIndex = -1;
  state.stairs.x = 0;
  state.stairs.y = 0;
  state.stairs.active = false;
  state.dropRng = createRng(dropSeed(seed));
  state.combatRng = createRng(combatSeed(seed)); // independent stream, reseeded per floor
  state.dropCounts.health = 0;
  state.dropCounts.melee = 0;
  state.dropCounts.ranged = 0;
  state.dropCounts.pierce = 0;
  state.dropCounts.knockback = 0;
  state.dropCounts.extraCharge = 0;
  state.dropCounts.fasterRecharge = 0;
  state.dropCounts.dashStrike = 0;
  state.dropCounts.lifesteal = 0;
  state.dropCounts.burn = 0;
  state.dropCounts.chain = 0;
  state.dropCounts.crit = 0;
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

/**
 * GIMMICK #2 — perform a pending boss SUMMON. The boss's SUMMON strike only
 * RECORDS intent (state.boss.pendingSummon) so Boss never imports spawnEnemy (no
 * Enemy<->Boss cycle); the spawn side-effect lives HERE. Spawns `count` adds along
 * the recorded line (origin + axis * (lineOffset + k*lineSpacing)) — a pierce-
 * friendly column — tagged to the boss room (so despawn-on-death + roomEnemyCount
 * treat them as the boss's), then clears the request. No-op when none pending.
 * Exported so the consume step is unit-testable in isolation. Spawns respect a
 * full pool (spawnEnemy returns false silently). Called from `update` after
 * updateEnemies. Idempotent: clears pendingSummon so it can't re-spawn next frame.
 */
export function consumeBossSummon(state: GameState): void {
  const summon = state.boss?.pendingSummon;
  if (!summon) return;
  for (let k = 0; k < summon.count; k++) {
    const dist = BOSS.summon.lineOffset + k * BOSS.summon.lineSpacing;
    spawnEnemy(
      state.enemies,
      summon.originX + summon.axisX * dist,
      summon.originY + summon.axisY * dist,
      state.run.depth,
      'bossadd',
      state.bossRoom,
    );
  }
  state.boss!.pendingSummon = null;
}

/** Deterministic next-floor seed from the current seed + the (new) depth. Pure +
 *  exported so the descent is reproducible and unit-testable. 32-bit via imul. */
export function nextFloorSeed(seed: number, depth: number): number {
  return (seed + Math.imul(DESCENT.seedStride, depth)) >>> 0;
}

/** Refresh stairs.active from the boss-death signal and, if the player is on the
 *  open stairs, DESCEND: bump run depth/floorsCleared and load the next floor.
 *  Returns true if a descent happened (caller should end the frame). */
function descendIfReady(state: GameState): boolean {
  const stairs = state.stairs;
  // Phase 8: the BOSS is the floor's climax + descent gate. Stairs unlock when the
  // floor's boss is DEAD — NOT when every room is cleared. The spanning-tree layout
  // lets the player reach + kill the boss with side rooms never entered, so an
  // all-cleared gate would strand them with no stairs (the progression-blocker).
  // Side rooms are now optional (loot/explore). bossDefeated is durable + per-floor
  // (set on boss death, reset in loadFloor); the stairs are already pinned to the
  // boss room by placeStairs on its clear (same frame), so they're positioned the
  // moment they activate and the player is standing on them.
  stairs.active = state.bossDefeated;
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
    // Phase 9: the four weapon LEVELS (ints) carry like the booleans did.
    meleeLevel: p.meleeLevel,
    rangedLevel: p.rangedLevel,
    pierceLevel: p.pierceLevel,
    knockbackLevel: p.knockbackLevel,
    extraChargeLevel: p.extraChargeLevel,
    fasterRecharge: p.fasterRecharge,
    dashStrike: p.dashStrike,
    lifestealLevel: p.lifestealLevel,
    burnLevel: p.burnLevel,
    chainLevel: p.chainLevel,
    critLevel: p.critLevel,
    health: p.health,
  };
  loadFloor(state, nextFloorSeed(state.seed, state.run.depth));
  state.player.meleeLevel = carried.meleeLevel;
  state.player.rangedLevel = carried.rangedLevel;
  state.player.pierceLevel = carried.pierceLevel;
  state.player.knockbackLevel = carried.knockbackLevel;
  state.player.extraChargeLevel = carried.extraChargeLevel;
  state.player.fasterRecharge = carried.fasterRecharge;
  state.player.dashStrike = carried.dashStrike;
  state.player.lifestealLevel = carried.lifestealLevel;
  state.player.burnLevel = carried.burnLevel;
  state.player.chainLevel = carried.chainLevel;
  state.player.critLevel = carried.critLevel;
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
  // Maintain the active room's seal: re-lock any doorway the player has vacated
  // (cells under the player are skipped on lock so they can't be embedded).
  updateEncounterDoors(state);

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
    fireProjectile(state.projectiles, p.x, p.y, aim.x, aim.y, p.rangedLevel); // Phase 9: multishot by level
    p.rangedCdTimer = RANGED.cooldown;
  }

  updateProjectiles(state, dt);
  updateEnemies(state, dt); // ranged enemies fire bolts here; the boss may request a summon
  consumeBossSummon(state); // GIMMICK #2: perform any wave the SUMMON strike recorded
  updateEnemyProjectiles(state, dt); // ...which travel + hit the player here

  // Deaths this frame -> run kill tally + seeded drop rolls at the death positions.
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (state.prevEnemyActive[i] && !e.active) {
      state.run.kills += 1;
      rollAndSpawnDrop(state, e.x, e.y, state.dropRng);
    }
  }
  // Phase 8: drop the boss companion state once the boss Enemy dies (its slot is
  // freed) so render/HUD/shield logic all switch off together. The death already
  // counted above + cleared the room via roomEnemyCount.
  if (state.boss && !state.enemies[state.boss.slot].active) {
    // GIMMICK #2 (adds): the boss is dead -> DESPAWN any lingering adds so (1) the
    // room clears on BOSS death (roomEnemyCount hits 0 in updateEncounterResolve
    // on the next line) instead of requiring every add dead — the research-
    // condemned grind — and (2) adds don't strand the room or chase the player
    // post-fight. The kill/drop loop above ran first (prevEnemyActive is snapshot
    // at frame start), so these despawns are NOT counted as kills and roll NO
    // drops. Non-boss rooms never reach here (state.boss is null).
    for (const a of state.enemies) {
      if (a.active && a.roomIndex === state.bossRoom) a.active = false;
    }
    state.boss = null;
    // Durable signal that THIS floor's boss is dead -> descent unlocks (see
    // descendIfReady). Survives state.boss going null; reset in loadFloor.
    state.bossDefeated = true;
  }
  // Clear the active room if its enemies are all dead -> unlock doors.
  updateEncounterResolve(state);
  // Collect any pickup the player is touching.
  updatePickups(state);

  // Descent: once the boss is dead the stairs open; stepping on them loads the
  // next floor. On descend the state is rebuilt, so end the frame here.
  if (descendIfReady(state)) return;

  updateParticles(state.particles, dt);
  updateChainArcs(state.chainArcs, dt); // fade chain-arc bolts (cosmetic)

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
