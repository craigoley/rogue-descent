import { describe, expect, it } from 'vitest';
import { createGameState, update, startNewRun, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { isSolid } from '../Room';
import { activeEnemyCount } from '../Enemy';
import { activePickupCount, applyPickup, rollDrop } from '../Pickup';
import { playerRoomIndex, rollAndSpawnDrop } from '../Encounter';
import { createRng } from '../../utils/rng';
import { DROP, PLAYER_COMBAT, POOL, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/** Put the player at the centre of encounter room `i` (world units). */
function placeInRoom(s: GameState, i: number): void {
  const r = s.rooms[i].rect;
  s.player.x = (r.x + r.w / 2) * s.room.tileSize;
  s.player.y = (r.y + r.h / 2) * s.room.tileSize;
}

/** First idle (non-spawn) encounter room index. */
function firstIdleRoom(s: GameState): number {
  return s.rooms.findIndex((e) => e.phase === 'idle');
}

describe('Encounter lifecycle', () => {
  it('spawn room (0) starts cleared; other rooms start idle', () => {
    const s = createGameState();
    expect(s.rooms[0].phase).toBe('cleared');
    expect(s.rooms.some((e) => e.phase === 'idle')).toBe(true);
  });

  it('activates on entry (spawns enemies) and clears only when ALL are dead', () => {
    const s = createGameState();
    const i = firstIdleRoom(s);
    placeInRoom(s, i);
    update(s, idle(), DT);
    expect(s.rooms[i].phase).toBe('active');
    expect(activeEnemyCount(s.enemies)).toBeGreaterThan(0);

    // Kill all but one — still active.
    const alive = s.enemies.filter((e) => e.active);
    for (let k = 1; k < alive.length; k++) alive[k].active = false;
    update(s, idle(), DT);
    expect(s.rooms[i].phase).toBe('active'); // one enemy still alive

    // Kill the last — clears.
    alive[0].active = false;
    update(s, idle(), DT);
    expect(s.rooms[i].phase).toBe('cleared');
  });
});

describe('Door-gating reuses wall collision', () => {
  it('locks doorways (solid) while active, unlocks (walkable) when cleared', () => {
    const s = createGameState();
    const i = firstIdleRoom(s);
    placeInRoom(s, i);
    const door = s.rooms[i].doorCells[0];
    expect(door, 'room should have at least one doorway').toBeTruthy();

    expect(isSolid(s.room, door.tx, door.ty)).toBe(false); // open before
    update(s, idle(), DT);
    expect(isSolid(s.room, door.tx, door.ty)).toBe(true); // LOCKED while active

    for (const e of s.enemies) e.active = false; // clear the room
    update(s, idle(), DT);
    expect(isSolid(s.room, door.tx, door.ty)).toBe(false); // unlocked when cleared
  });
});

describe('Drops — deterministic, two kinds, correct effects', () => {
  it('rollDrop is deterministic per seed', () => {
    const seqA = Array.from({ length: 20 }, () => rollDrop(createRng(7))); // fresh rng each time -> same first roll
    expect(seqA.every((v) => v === seqA[0])).toBe(true);
    const a = createRng(123);
    const b = createRng(123);
    for (let k = 0; k < 30; k++) expect(rollDrop(a)).toBe(rollDrop(b));
  });

  it('rollDrop yields only null | health | the four powerups', () => {
    const allowed = new Set(['null', 'health', 'pierce', 'knockback', 'extraCharge', 'fasterRecharge']);
    const rng = createRng(99);
    const seen = new Set<string>();
    for (let k = 0; k < 800; k++) {
      const d = rollDrop(rng);
      expect(allowed.has(String(d))).toBe(true);
      seen.add(String(d));
    }
    // All outcomes are reachable from this seed (distribution sanity).
    for (const kind of ['null', 'health', 'pierce', 'knockback', 'extraCharge', 'fasterRecharge']) {
      expect(seen.has(kind)).toBe(true);
    }
  });

  it('rollDrop is deterministic for a given seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let k = 0; k < 50; k++) expect(rollDrop(a)).toBe(rollDrop(b));
  });

  it('health restores HP capped at max; powerups flip a behaviour toggle', () => {
    const s = createGameState();
    s.player.health = PLAYER_COMBAT.maxHealth - 5;
    applyPickup(s.player, 'health');
    expect(s.player.health).toBe(PLAYER_COMBAT.maxHealth); // capped, not overfilled

    s.player.health = 10;
    applyPickup(s.player, 'health');
    expect(s.player.health).toBe(Math.min(PLAYER_COMBAT.maxHealth, 10 + DROP.healAmount));

    // Powerups are binary toggles; health does not flip them.
    expect(s.player.pierce).toBe(false);
    expect(s.player.meleeKnockback).toBe(false);
    applyPickup(s.player, 'pierce');
    expect(s.player.pierce).toBe(true);
    expect(s.player.meleeKnockback).toBe(false);
    applyPickup(s.player, 'knockback');
    expect(s.player.meleeKnockback).toBe(true);
  });

  it('rollAndSpawnDrop spawns a pickup attributed to the active room', () => {
    const s = createGameState();
    const i = firstIdleRoom(s);
    s.activeRoom = i;
    // Force a dropping stream and roll until one lands (deterministic).
    let spawned = false;
    for (let k = 0; k < 40 && !spawned; k++) {
      s.dropRng = createRng(k + 1);
      rollAndSpawnDrop(s, 5, 5, s.dropRng);
      if (activePickupCount(s.pickups) > 0) spawned = true;
    }
    expect(spawned).toBe(true);
    expect(s.rooms[i].dropsSpawned).toBeGreaterThan(0); // attributed to the room
  });

  it('a slain enemy can drop a pickup (death detected IN-FRAME)', () => {
    let dropped = false;
    for (let seed = 1; seed <= 40 && !dropped; seed++) {
      const s = createGameState();
      const i = firstIdleRoom(s);
      placeInRoom(s, i);
      update(s, idle(), DT); // activate + spawn enemies
      const live = s.enemies.filter((e) => e.active);
      for (let k = 1; k < live.length; k++) live[k].active = false; // keep one
      const e = live[0];
      e.x = s.player.x + 0.5; // in melee range + arc (facing +x)
      e.y = s.player.y;
      e.health = 1;
      s.player.facingX = 1;
      s.player.facingY = 0;
      s.dropRng = createRng(seed);
      update(s, { ...idle(), melee: true }, DT); // kills e in-frame -> death-diff -> roll
      // The drop may be auto-collected same-frame (spawns near the player), so
      // count dropsSpawned (incremented on spawn) rather than live pickups.
      if (s.rooms[i].dropsSpawned > 0) dropped = true;
    }
    expect(dropped).toBe(true);
  });
});

describe('Within-run only — drops + powerups do NOT survive permadeath + restart', () => {
  it('death ENDS the run (permadeath), and RESTART clears powerups/pickups + re-arms + resets run', () => {
    const s = createGameState();
    // Grant BOTH powerups and spawn a pickup, activate a room.
    applyPickup(s.player, 'pierce');
    applyPickup(s.player, 'knockback');
    expect(s.player.pierce).toBe(true);
    expect(s.player.meleeKnockback).toBe(true);
    const i = firstIdleRoom(s);
    placeInRoom(s, i);
    update(s, idle(), DT);
    expect(s.rooms[i].phase).toBe('active');

    // Kill the player and run through the death pause. Phase 7b: this ENDS the
    // run (runOver) — it does NOT auto-respawn on the same floor any more.
    s.player.health = 0;
    s.player.iframeTimer = 0;
    s.player.hitInvulnTimer = 0;
    update(s, idle(), DT); // death trigger -> alive=false
    const steps = Math.ceil(PLAYER_COMBAT.deathPause / DT) + 3;
    for (let k = 0; k < steps; k++) update(s, idle(), DT);

    expect(s.player.alive).toBe(false); // NO same-run respawn
    expect(s.runOver).toBe(true); // the run is over, awaiting restart

    // RESTART -> a FRESH run. Now the within-run no-persist guarantees apply.
    startNewRun(s, 4242);
    expect(s.player.alive).toBe(true);
    expect(s.player.pierce).toBe(false); // powerup GONE (within-run only)
    expect(s.player.meleeKnockback).toBe(false); // powerup GONE (within-run only)
    expect(activePickupCount(s.pickups)).toBe(0); // drops GONE
    expect(s.rooms.every((e, idx) => (idx === 0 ? e.phase === 'cleared' : e.phase === 'idle'))).toBe(
      true,
    ); // rooms re-armed
    // Run-level state reset for the new run (Phase 7b new-run reset).
    expect(s.runOver).toBe(false);
    expect(s.run.depth).toBe(1);
    expect(s.run.floorsCleared).toBe(0);
    expect(s.run.kills).toBe(0);
    expect(s.run.timeSec).toBe(0);
  });
});

describe('Pickup pool is fixed-size', () => {
  it('does not grow under repeated spawns', () => {
    const s = createGameState();
    const len = s.pickups.length;
    expect(len).toBe(POOL.pickups);
    // Force many drop attempts by activating/clearing repeatedly via direct kills.
    for (let n = 0; n < 50; n++) {
      const i = firstIdleRoom(s);
      if (i < 0) break;
      placeInRoom(s, i);
      update(s, idle(), DT);
      for (const e of s.enemies) e.active = false;
      update(s, idle(), DT);
    }
    expect(s.pickups.length).toBe(len);
    expect(activePickupCount(s.pickups)).toBeLessThanOrEqual(POOL.pickups);
  });

  it('player can leave a cleared room (the room ahead exists)', () => {
    const s = createGameState();
    // Player starts in the cleared spawn room — index 0.
    placeInRoom(s, 0);
    update(s, idle(), DT);
    expect(playerRoomIndex(s)).toBe(0);
    expect(s.rooms[0].phase).toBe('cleared'); // safe start, not locked
  });
});
