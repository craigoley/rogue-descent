/**
 * GOLDEN CHESTS — PR1 (chest + the spatial 1-of-2 choice + spawn; NO mimic). Pins:
 *   - ⭐ an UNOPENED chest does NOT count toward the clear-gate (a room clears on its
 *     enemies alone — the chest is never in the enemy pool). The key no-regression guard.
 *   - a chest opens ONLY when its room phase === 'cleared' (inert during 'active').
 *   - the 2-pick grants EXACTLY ONE: collecting one applies it + deactivates the sibling.
 *   - offered picks are 2 DISTINCT, non-maxed kinds (1 effect + 1 stat); the
 *     all-effects-maxed fallback yields 2 distinct stat/health picks.
 *   - chestRng is independent of dropRng/combatRng (opening chests doesn't desync them).
 * Deterministic — chest content rolls go through the seeded chestRng (stubbable).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startNewRun, update, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { spawnEnemy, roomEnemyCount } from '../Enemy';
import { updateEncounterResolve } from '../Encounter';
import { chooseChestPicks, currentPowerupLevel, rollDrop, activePickupCount, spawnPickup, type PickupKind } from '../Pickup';
import { createRng } from '../../utils/rng';
import { PICKUP, PLAYER, POOL, POWERUP_MAX_LEVEL, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const EFFECTS = new Set<PickupKind>(['lifesteal', 'burn', 'chain', 'crit']);

/** Run `seconds` of sim at the fixed step (no input → the player holds position). */
function advance(s: GameState, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) update(s, createIntent(), DT);
}

/** Fresh state with pools cleared; one chest placed at room `ri`'s centre. */
function withChest(ri = 1): { s: GameState; chest: GameState['chests'][number]; cx: number; cy: number } {
  const s = createGameState();
  for (const e of s.enemies) e.active = false;
  for (const c of s.chests) c.active = false;
  for (const pk of s.pickups) pk.active = false;
  const r = s.rooms[ri].rect;
  const ts = s.room.tileSize;
  const cx = (r.x + r.w / 2) * ts;
  const cy = (r.y + r.h / 2) * ts;
  const chest = s.chests[0];
  chest.active = true;
  chest.opened = false;
  chest.roomIndex = ri;
  chest.x = cx;
  chest.y = cy;
  return { s, chest, cx, cy };
}

/** Did the player gain `kind` (level up, or HP for health)? */
function gained(s: GameState, kind: PickupKind, baseLevel: number, baseHealth: number): boolean {
  if (kind === 'health') return s.player.health > baseHealth;
  return currentPowerupLevel(s.player, kind) > baseLevel;
}

describe('Chest — gating (the no-regression guard)', () => {
  it('an UNOPENED chest does NOT keep a room from clearing (not an enemy)', () => {
    const { s, chest } = withChest(1);
    s.rooms[1].phase = 'active';
    s.activeRoom = 1;
    spawnEnemy(s.enemies, chest.x + 1, chest.y, 1, 'chaser', 1);
    expect(roomEnemyCount(s.enemies, 1)).toBe(1);
    updateEncounterResolve(s);
    expect(s.rooms[1].phase).toBe('active'); // enemy alive → still locked
    // Kill the enemy; the room clears despite the chest sitting in it.
    s.enemies.find((e) => e.active)!.active = false;
    expect(roomEnemyCount(s.enemies, 1)).toBe(0); // chest never counted
    updateEncounterResolve(s);
    expect(s.rooms[1].phase).toBe('cleared');
    expect(chest.active && !chest.opened).toBe(true); // still there, unopened
  });
});

describe('Chest — opens only when cleared, on contact', () => {
  it('does NOT open while the room is active; opens once cleared', () => {
    const { s, chest, cx, cy } = withChest(1);
    s.player.x = cx;
    s.player.y = cy; // standing on the chest
    s.rooms[1].phase = 'active';
    update(s, createIntent(), DT);
    expect(chest.opened).toBe(false); // inert during the fight

    s.rooms[1].phase = 'cleared';
    s.player.x = cx;
    s.player.y = cy;
    update(s, createIntent(), DT);
    expect(chest.opened).toBe(true); // post-clear contact opens it
    expect(activePickupCount(s.pickups)).toBe(2); // the 1-of-2 pickups popped
  });
});

describe('Chest — the 1-of-2 choice PRESENTS (offset approach + grace)', () => {
  // ⚠️ REAL-PLAY CONDITION. The old guard placed the player DEAD CENTRE — the one spot
  // where both picks survive — so it passed while the choice never presented in actual
  // play (#70 H1: you contact-open from a SIDE, the near pick spawns inside collection
  // reach and is grabbed same-frame + the sibling despawns → "got nothing"). These pin
  // the fix: BOTH picks spawn clear of the player, and a presentation grace holds
  // collection so the choice is always seen before either can be taken.

  it('approaching from a side pops BOTH picks clear of the player; NEITHER is auto-collected', () => {
    const { s, cx, cy } = withChest(1);
    s.rooms[1].phase = 'cleared';
    s.player.x = cx + 0.9; // walked INTO the chest from the right (as in real play)
    s.player.y = cy;
    update(s, createIntent(), DT); // contact → open

    const picks = s.pickups.filter((pk) => pk.active);
    expect(picks).toHaveLength(2); // the choice popped
    expect(s.rooms[1].dropsCollected).toBe(0); // nothing grabbed at spawn (the bug, now fixed)
    const reach = PICKUP.radius + PLAYER.radius;
    for (const pk of picks) {
      const dist = Math.hypot(pk.x - s.player.x, pk.y - s.player.y);
      expect(dist).toBeGreaterThan(reach); // both spawned OUTSIDE collection reach
      expect(pk.spawnGrace).toBeGreaterThan(0); // ...and not yet collectable (grace held)
    }
  });

  it('a pick the player OVERLAPS is NOT collected during the grace, but IS after it (and grants exactly one)', () => {
    const { s, cx, cy } = withChest(1);
    s.rooms[1].phase = 'cleared';
    s.player.x = cx + 0.9; // side approach
    s.player.y = cy;
    s.player.health = 50; // hurt, so a health pick is observable
    update(s, createIntent(), DT); // open → 2 picks, both in their grace window
    const pair = s.pickups.filter((pk) => pk.active);
    expect(pair).toHaveLength(2);
    const [pa, pb] = pair;
    const baseLevelA = currentPowerupLevel(s.player, pa.kind);
    const baseLevelB = currentPowerupLevel(s.player, pb.kind);
    const baseHealth = s.player.health;

    // Park ON pick A but WITHIN its grace: shown, NOT grabbed (the choice still presents).
    s.player.x = pa.x;
    s.player.y = pa.y;
    update(s, createIntent(), DT);
    expect(activePickupCount(s.pickups)).toBe(2); // grace holds — both still on offer
    expect(gained(s, pa.kind, baseLevelA, baseHealth)).toBe(false); // nothing applied yet

    // Let the grace expire (still standing on A) → now it collects + the sibling despawns.
    advance(s, PICKUP.spawnGrace + 2 * DT);
    expect(gained(s, pa.kind, baseLevelA, baseHealth)).toBe(true); // A applied
    expect(activePickupCount(s.pickups)).toBe(0); // sibling B deactivated, not collected
    if (pb.kind !== pa.kind) {
      expect(gained(s, pb.kind, baseLevelB, baseHealth)).toBe(false); // exactly one taken
    }
  });

  it('collecting one of a linked pair announces EXACTLY ONCE — the rejected sibling is discarded SILENTLY', () => {
    // ⚠️ The double-toast bug: applyPickup was already exactly-once, but BOTH name
    // toasts fired. The renderer announces a pickup when it goes active→inactive WITH
    // `collected` set — so the sim must flag ONLY the taken pick, leaving the discarded
    // sibling silent. This pins that: exactly one `collected` (one announcement), not two.
    const { s, cx, cy } = withChest(1);
    s.rooms[1].phase = 'cleared';
    s.player.x = cx + 0.9; // side approach
    s.player.y = cy;
    update(s, createIntent(), DT); // open → 2 picks (in grace)
    const pair = s.pickups.filter((pk) => pk.active);
    expect(pair).toHaveLength(2);
    const [pa, pb] = pair; // pa = the pick we take; pb = its sibling

    // Take pick A (stand on it, let the grace expire) → A collected, B discarded.
    s.player.x = pa.x;
    s.player.y = pa.y;
    advance(s, PICKUP.spawnGrace + 2 * DT);

    expect(pa.active).toBe(false);
    expect(pb.active).toBe(false);
    expect(pa.collected).toBe(true); // the TAKEN pick announces
    expect(pb.collected).toBe(false); // the sibling: removed with NO collection feedback
    expect(s.pickups.filter((pk) => pk.collected)).toHaveLength(1); // EXACTLY ONE announcement
    expect(s.rooms[1].dropsCollected).toBe(1); // ...and exactly one applyPickup/collection
  });
});

describe('Chest — pick selection (interesting + non-maxed)', () => {
  it('offers 1 EFFECT + 1 STAT, both distinct, for a fresh player', () => {
    const s = createGameState();
    const [a, b] = chooseChestPicks(s.player, createRng(42));
    expect(a).not.toBe(b);
    expect(EFFECTS.has(a)).toBe(true); // the guaranteed effect axis
    expect(EFFECTS.has(b)).toBe(false); // the stat/health side
  });

  it('never offers a MAXED kind', () => {
    const s = createGameState();
    s.player.burnLevel = POWERUP_MAX_LEVEL;
    s.player.meleeLevel = POWERUP_MAX_LEVEL;
    // Try many seeds; a maxed kind must never appear.
    for (let seed = 0; seed < 50; seed++) {
      const [a, b] = chooseChestPicks(s.player, createRng(seed));
      for (const k of [a, b]) {
        if (k !== 'health') expect(currentPowerupLevel(s.player, k)).toBeLessThan(POWERUP_MAX_LEVEL);
      }
    }
  });

  it('all-effects-maxed FALLBACK: 2 distinct stat/health picks (no effect available)', () => {
    const s = createGameState();
    for (const k of EFFECTS) {
      // max every effect axis
      if (k === 'lifesteal') s.player.lifestealLevel = POWERUP_MAX_LEVEL;
      if (k === 'burn') s.player.burnLevel = POWERUP_MAX_LEVEL;
      if (k === 'chain') s.player.chainLevel = POWERUP_MAX_LEVEL;
      if (k === 'crit') s.player.critLevel = POWERUP_MAX_LEVEL;
    }
    const [a, b] = chooseChestPicks(s.player, createRng(7));
    expect(EFFECTS.has(a)).toBe(false);
    expect(EFFECTS.has(b)).toBe(false);
    expect(a).not.toBe(b); // still two distinct live options
  });
});

describe('Chest — chestRng is independent of drop + combat streams', () => {
  it('opening chests does not shift the drop sequence', () => {
    const SEED = 13337;
    const a = createGameState();
    startNewRun(a, SEED);
    const dropsA = Array.from({ length: 20 }, () => rollDrop(a.dropRng));

    const b = createGameState();
    startNewRun(b, SEED);
    // Open several chests (draws chestRng), never touching dropRng.
    for (let i = 0; i < 10; i++) chooseChestPicks(b.player, b.chestRng);
    const dropsB = Array.from({ length: 20 }, () => rollDrop(b.dropRng));

    expect(dropsB).toEqual(dropsA);
  });
});

describe('Chest — loot is GUARANTEED even when the pickup pool is full (B2)', () => {
  it('opening a chest at a full pool evicts stale floor drops so BOTH picks spawn', () => {
    const { s, cx, cy } = withChest(1);
    s.rooms[1].phase = 'cleared';
    s.player.x = cx;
    s.player.y = cy;
    s.chestRng = { next: () => 0.99, int: () => 0 }; // >= mimicChance → forced LOOT
    // FILL the pickup pool with stale FLOOR drops (pairId -1), far from the player so
    // they aren't collected this frame.
    for (let i = 0; i < POOL.pickups; i++) spawnPickup(s.pickups, 0, 0, 'health', -1);
    expect(activePickupCount(s.pickups)).toBe(POOL.pickups); // full

    update(s, createIntent(), DT); // open → popLoot must make room for the 2 picks

    // Both chest picks (pairId = chest slot 0 + 1 = 1) spawned despite the full pool.
    const chestPicks = s.pickups.filter((pk) => pk.active && pk.pairId === 1);
    expect(chestPicks).toHaveLength(2);
    expect(activePickupCount(s.pickups)).toBe(POOL.pickups); // still capped (2 stale evicted)
  });
});
