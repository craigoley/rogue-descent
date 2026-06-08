/**
 * META PR2 — two more unlockables across the remaining dimensions + the first SKILL-
 * attributed milestone counter. Pins:
 *   ⭐ WILDFIRE counter (Def C — the crux): a burn-TICK kill on a CHAIN-spread enemy
 *      increments run.wildfireKills; a direct kill, AND a tick-kill on a DIRECT-ignited
 *      enemy, do NOT. The definition's precision IS the test.
 *   ⭐ CONTENT GATING per dimension: 'fireRate' enters the powerup pool only when
 *      unlocked (base never); 'armored-chaser' enters the depth-3 spawn mix only when
 *      unlocked (base never). The config→pure-sim boundary, extended to enemy + track.
 *   - FIRE-RATE is power-neutral variety: an in-run track that shortens the shot
 *     cooldown by level (meta only unlocks the OPTION).
 *   - base config = today: no armored, no fireRate, the counter unlocks nothing below
 *     threshold (the regression guard lives in the rest of the suite staying green).
 * Deterministic — config is a pure input; the wildfire path has no RNG.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startNewRun, update, type GameState, type RunConfig } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import { buildTestRoom, roomCenter } from '../Room';
import { spawnEnemy } from '../Enemy';
import { damageEnemy } from '../Combat';
import { rollDrop } from '../Pickup';
import { createRng } from '../../utils/rng';
import { FIRE_RATE_LEVELS, RANGED, SIM_DT } from '../../utils/constants';
import { idle, placeInRoom } from './l1-harness';

const DT = SIM_DT;

/** Bare combat arena (mirrors burn.test): test room, player centred, pools cleared. */
function arena(): GameState {
  const s = createGameState();
  s.room = buildTestRoom();
  const c = roomCenter(s.room);
  s.spawn = { x: c.x, y: c.y };
  s.player = createPlayer(c.x, c.y);
  for (const e of s.enemies) e.active = false;
  s.rooms = [];
  s.activeRoom = -1;
  return s;
}
function enemyAt(s: GameState, x: number, y: number) {
  spawnEnemy(s.enemies, x, y);
  const e = s.enemies.find((en) => en.active)!;
  e.health = 10_000; // survives the ignite; the explicit tick is what kills
  return e;
}

describe('⭐ Wildfire counter (Def C — burn-tick kill on a chain-spread enemy)', () => {
  it('a tick-kill on a CHAIN-ignited enemy increments run.wildfireKills', () => {
    const s = arena();
    s.player.burnLevel = 2;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s, 'chain'); // chain arc ignites → fire SPREAD here
    expect(e.ignitedByChain).toBe(true);
    expect(s.run.wildfireKills).toBe(0); // not yet — it's still alive
    damageEnemy(e, e.health, 0, 0, 0, s, 'tick'); // the spread fire burns it down
    expect(e.active).toBe(false);
    expect(s.run.wildfireKills).toBe(1); // WILDFIRE kill
  });

  it('a tick-kill on a DIRECT-ignited enemy does NOT count (you lit it yourself)', () => {
    const s = arena();
    s.player.burnLevel = 2;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s, 'direct'); // direct ignite → not spread
    expect(e.ignitedByChain).toBe(false);
    damageEnemy(e, e.health, 0, 0, 0, s, 'tick'); // burns down, but not chain-spread
    expect(e.active).toBe(false);
    expect(s.run.wildfireKills).toBe(0); // NOT a wildfire kill
  });

  it('a DIRECT killing blow never counts (only burn ticks are wildfire)', () => {
    const s = arena();
    s.player.burnLevel = 2;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s, 'chain'); // chain-ignited (ignitedByChain = true)
    damageEnemy(e, e.health, 1, 0, 0, s, 'direct'); // ...but a DIRECT blow finishes it
    expect(e.active).toBe(false);
    expect(s.run.wildfireKills).toBe(0); // the killer wasn't the fire
  });

  it('a CHAIN killing blow never counts either (the kind must be tick)', () => {
    const s = arena();
    s.player.burnLevel = 2;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s, 'chain'); // chain-ignited
    damageEnemy(e, e.health, 1, 0, 0, s, 'chain'); // a chain arc lands the kill (not a tick)
    expect(e.active).toBe(false);
    expect(s.run.wildfireKills).toBe(0);
  });

  it('a later DIRECT re-ignite clears the chain attribution', () => {
    const s = arena();
    s.player.burnLevel = 3;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s, 'chain');
    expect(e.ignitedByChain).toBe(true);
    damageEnemy(e, 10, 1, 0, 0, s, 'direct'); // you hit it directly → no longer "spread"
    expect(e.ignitedByChain).toBe(false);
    damageEnemy(e, e.health, 0, 0, 0, s, 'tick');
    expect(s.run.wildfireKills).toBe(0);
  });
});

describe('Fire-rate — track gating + power-neutral variety', () => {
  it('⭐ floor drops include fireRate only when unlocked; base never rolls it', () => {
    const seen = (unlocked: ReadonlySet<string>): boolean => {
      const rng = createRng(4242);
      for (let i = 0; i < 4000; i++) if (rollDrop(rng, unlocked) === 'fireRate') return true;
      return false;
    };
    expect(seen(new Set())).toBe(false); // base config → never
    expect(seen(new Set(['fireRate']))).toBe(true); // unlocked → appears
  });

  it('a higher fire-rate level shortens the ranged cooldown (variety, an in-run track)', () => {
    const fireOnce = (level: number): number => {
      const s = arena();
      s.player.fireRateLevel = level;
      update(s, { ...createIntent(), ranged: true }, DT);
      return s.player.rangedCdTimer;
    };
    // Level 0 = base cooldown unchanged; higher levels = shorter interval.
    expect(fireOnce(0)).toBeCloseTo(RANGED.cooldown * FIRE_RATE_LEVELS.cooldownMult[0], 5);
    expect(fireOnce(3)).toBeCloseTo(RANGED.cooldown * FIRE_RATE_LEVELS.cooldownMult[3], 5);
    expect(fireOnce(3)).toBeLessThan(fireOnce(0)); // faster, but the LEVEL is earned in-run
  });
});

describe('Armored chaser — enemy gating (depth 3, unlocked only)', () => {
  const SEED = 73101;

  /** Descend once (the l1-spawn-mix pattern) so config carries across floors. */
  function descendOnce(s: GameState): void {
    for (let i = 0; i < s.rooms.length; i++) s.rooms[i].phase = i === 1 ? 'active' : 'cleared';
    s.activeRoom = 1;
    s.bossDefeated = true;
    s.player.x = s.spawn.x;
    s.player.y = s.spawn.y;
    update(s, idle(), DT);
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    update(s, idle(), DT);
  }
  function runAtDepth(depth: number, config?: RunConfig): GameState {
    const s = createGameState(config);
    startNewRun(s, SEED, config);
    for (let d = 1; d < depth; d++) descendOnce(s);
    expect(s.run.depth).toBe(depth);
    return s;
  }
  function activatedRoomTypes(s: GameState): Set<string> {
    const room = s.rooms.findIndex((r, i) => i !== 0 && i !== s.bossRoom && r.phase === 'idle' && r.spawns.length > 0);
    expect(room).toBeGreaterThan(0);
    placeInRoom(s, room);
    update(s, idle(), DT);
    const types = new Set<string>();
    for (const e of s.enemies) if (e.active && e.roomIndex === room) types.add(e.type);
    return types;
  }

  const ARMORED: RunConfig = { unlocked: new Set(['armored-chaser']), runStart: null };

  it('⭐ depth 3 with armored-chaser UNLOCKED spawns an armored variant', () => {
    expect(activatedRoomTypes(runAtDepth(3, ARMORED)).has('armored')).toBe(true);
  });

  it('⭐ base config NEVER spawns armored, even at depth 3 (the regression guard)', () => {
    expect(activatedRoomTypes(runAtDepth(3)).has('armored')).toBe(false);
  });

  it('armored is gated by DEPTH too: unlocked but depth 2 → still none', () => {
    expect(activatedRoomTypes(runAtDepth(2, ARMORED)).has('armored')).toBe(false);
  });

  it('a plain chaser always remains (armored never takes the leading slot)', () => {
    expect(activatedRoomTypes(runAtDepth(3, ARMORED)).has('chaser')).toBe(true);
  });
});
