import { describe, expect, it } from 'vitest';
import { createGameState, update, startNewRun, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { PLAYER_COMBAT, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/** Run the death pause to completion from a freshly-killed player. */
function killAndElapse(s: GameState): void {
  s.player.health = 0;
  s.player.iframeTimer = 0;
  s.player.hitInvulnTimer = 0;
  update(s, idle(), DT); // death trigger -> alive=false, deathTimer set
  const steps = Math.ceil(PLAYER_COMBAT.deathPause / DT) + 3;
  for (let k = 0; k < steps; k++) update(s, idle(), DT);
}

describe('Permadeath — death ENDS the run (no same-floor respawn)', () => {
  it('after the death pause the run is over and the floor is NOT reloaded', () => {
    const s = createGameState();
    const seed0 = s.seed;

    s.player.health = 0;
    s.player.iframeTimer = 0;
    s.player.hitInvulnTimer = 0;
    update(s, idle(), DT);
    expect(s.player.alive).toBe(false);
    expect(s.runOver).toBe(false); // still in the death-pause lead-in

    const steps = Math.ceil(PLAYER_COMBAT.deathPause / DT) + 3;
    for (let k = 0; k < steps; k++) update(s, idle(), DT);

    expect(s.runOver).toBe(true); // run over
    expect(s.player.alive).toBe(false); // NOT respawned (the old behaviour)
    expect(s.seed).toBe(seed0); // same floor — no loadFloor happened
  });

  it('the sim stays frozen at run-over until restart', () => {
    const s = createGameState();
    killAndElapse(s);
    const x = s.player.x;
    update(s, { ...idle(), moveX: 1, moveY: 1 }, DT); // try to move
    expect(s.player.x).toBe(x); // frozen
    expect(s.runOver).toBe(true);
  });

  it('startNewRun begins a fresh run from a new seed (depth reset, runOver cleared)', () => {
    const s = createGameState();
    killAndElapse(s);
    startNewRun(s, 7);
    expect(s.runOver).toBe(false);
    expect(s.player.alive).toBe(true);
    expect(s.run.depth).toBe(1);
    expect(s.seed).toBe(7);
  });
});

describe('Permadeath — run stats accumulate during the run', () => {
  it('kills increments when an enemy dies', () => {
    const s = createGameState();
    const i = s.rooms.findIndex((r, idx) => idx > 0 && r.phase === 'idle');
    const r = s.rooms[i].rect;
    const ts = s.room.tileSize;
    s.player.x = (r.x + r.w / 2) * ts;
    s.player.y = (r.y + r.h / 2) * ts;
    update(s, idle(), DT); // activate the room -> spawn enemies

    const live = s.enemies.filter((e) => e.active);
    expect(live.length).toBeGreaterThan(0);
    const before = s.run.kills;

    // Keep one enemy (deactivate the rest out-of-band so only the melee'd one
    // transitions active->inactive this frame), then melee-kill it.
    for (let k = 1; k < live.length; k++) live[k].active = false;
    const e = live[0];
    e.x = s.player.x + 0.5;
    e.y = s.player.y;
    e.health = 1;
    s.player.facingX = 1;
    s.player.facingY = 0;
    update(s, { ...idle(), melee: true }, DT);

    expect(s.run.kills).toBe(before + 1);
  });

  it('timeSec survives a descent (run clock, not per-life/per-floor)', () => {
    const s = createGameState();
    for (let k = 0; k < 10; k++) update(s, idle(), DT); // accumulate run time
    const before = s.run.timeSec;
    expect(before).toBeGreaterThan(0);

    // Clear the floor (room 1 last) + kill the boss, then step on the stairs.
    for (let i = 0; i < s.rooms.length; i++) s.rooms[i].phase = i === 1 ? 'active' : 'cleared';
    s.activeRoom = 1;
    s.bossDefeated = true; // Phase 8: descent gates on the boss being dead
    s.player.x = s.spawn.x;
    s.player.y = s.spawn.y;
    update(s, idle(), DT); // resolves room 1 -> stairs placed + active
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    const depthBefore = s.run.depth;
    update(s, idle(), DT); // descend

    expect(s.run.depth).toBe(depthBefore + 1); // we actually descended
    expect(s.run.timeSec).toBeGreaterThanOrEqual(before); // and the clock survived
  });
});
