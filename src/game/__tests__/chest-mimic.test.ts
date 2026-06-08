/**
 * GOLDEN CHESTS — PR-C (the MIMIC). The gating-risk PR, so the guards center on the
 * softlock class:
 *   - ⭐ open-mimic RE-LOCKS + COUNTS: opening a mimic chest re-activates the room
 *     (phase 'active', doors locked) with the mimic tagged → roomEnemyCount === 1,
 *     ATOMICALLY in the open tick (no gating window).
 *   - ⭐ kill-mimic RE-CLEARS + UNLOCKS: the mimic dies → roomEnemyCount → 0 → the
 *     unchanged updateEncounterResolve clears the room + unlocks (THE softlock guard).
 *   - the mimic spawns STUNNED for the tell (counted but harmless), then chases.
 *   - the roll is seeded/deterministic; open resolves to EITHER loot OR mimic.
 *   - drops the chest loot on the mimic's death (the fair gamble).
 * Genuine: spawning the mimic UNTAGGED breaks the count → the re-lock/re-clear guard
 * goes RED (proves it's not vacuous).
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { roomEnemyCount } from '../Enemy';
import { activePickupCount } from '../Pickup';
import { CHEST, SIM_DT } from '../../utils/constants';
import type { Rng } from '../../utils/rng';

const DT = SIM_DT;

/** A chestRng stub: next() returns a fixed value. 0 → mimic (0 < mimicChance);
 *  0.99 → loot (>= mimicChance). int() mirrors createRng's formula off that value. */
function forcedRng(v: number): Rng {
  return { next: () => v, int: (lo: number, hi: number) => (hi <= lo ? lo : lo + Math.floor(v * (hi - lo + 1))) };
}

/** Fresh state, pools cleared, one chest in room `ri` whose room is CLEARED and with
 *  the player standing on the chest (so the next update() opens it). */
function armedChest(forced: number, ri = 1): { s: GameState; chest: GameState['chests'][number]; ri: number } {
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
  chest.mimicFighting = false;
  chest.roomIndex = ri;
  chest.x = cx;
  chest.y = cy;
  s.rooms[ri].phase = 'cleared';
  s.activeRoom = -1;
  s.player.x = cx;
  s.player.y = cy;
  s.chestRng = forcedRng(forced);
  return { s, chest, ri };
}

const mimicOf = (s: GameState, ri: number) => s.enemies.find((e) => e.active && e.roomIndex === ri);

describe('Chest mimic — open re-locks + counts (atomic)', () => {
  it('opening a mimic chest re-activates the room with the mimic tagged (count 1), same tick', () => {
    const { s, chest, ri } = armedChest(0); // forced mimic
    update(s, createIntent(), DT); // contact → openChest → mimic

    expect(chest.opened).toBe(true);
    expect(chest.mimicFighting).toBe(true);
    expect(s.rooms[ri].phase).toBe('active'); // RE-LOCKED
    expect(s.activeRoom).toBe(ri);
    expect(roomEnemyCount(s.enemies, ri)).toBe(1); // the mimic is tagged + counted
    expect(activePickupCount(s.pickups)).toBe(0); // mimic, NOT loot — no pickups at open
    // buffed
    const mimic = mimicOf(s, ri)!;
    expect(mimic.type).toBe('chaser');
  });

  it('the mimic spawns STUNNED for the tell (counted but harmless), then frees', () => {
    const { s, ri } = armedChest(0);
    update(s, createIntent(), DT);
    const mimic = mimicOf(s, ri)!;
    expect(mimic.stunTimer).toBeGreaterThan(0); // frozen during the wobble tell
    expect(mimic.stunTimer).toBeCloseTo(CHEST.wobbleDuration, 5);
    // Tick past the tell — the stun decrements toward 0 (it can then chase).
    for (let i = 0; i < Math.ceil(CHEST.wobbleDuration / DT) + 2; i++) update(s, createIntent(), DT);
    expect(mimic.active).toBe(true);
    expect(mimic.stunTimer).toBe(0);
  });
});

describe('Chest mimic — kill re-clears + unlocks + drops loot (the softlock guard)', () => {
  it('a mimic-locked room re-clears on the mimic death AND pops the chest loot', () => {
    const { s, chest, ri } = armedChest(0);
    update(s, createIntent(), DT); // open → mimic
    // PRECONDITION (proves the lock is real — this is what the untagged neuter breaks):
    expect(s.rooms[ri].phase).toBe('active');
    expect(roomEnemyCount(s.enemies, ri)).toBe(1);

    // Kill the mimic; the next step resolves the room + delivers the loot.
    mimicOf(s, ri)!.active = false;
    update(s, createIntent(), DT);

    expect(roomEnemyCount(s.enemies, ri)).toBe(0);
    expect(s.rooms[ri].phase).toBe('cleared'); // RE-CLEARED via the unchanged resolve
    expect(s.activeRoom).toBe(-1); // unlocked
    expect(chest.mimicFighting).toBe(false);
    expect(chest.active).toBe(false); // chest consumed
    expect(activePickupCount(s.pickups)).toBe(2); // the 2-pick loot popped (fight THEN loot)
  });
});

describe('Chest mimic — the roll (deterministic) / either-or', () => {
  it('forced loot opens the #70 2-pick and spawns NO enemy', () => {
    const { s, ri } = armedChest(0.99); // forced loot
    update(s, createIntent(), DT);
    expect(activePickupCount(s.pickups)).toBe(2); // loot
    expect(roomEnemyCount(s.enemies, ri)).toBe(0); // no mimic
    expect(s.rooms[ri].phase).toBe('cleared'); // stayed cleared (no re-activate)
  });

  it('forced mimic spawns the enemy and pops NO pickups (never both)', () => {
    const { s, ri } = armedChest(0);
    update(s, createIntent(), DT);
    expect(roomEnemyCount(s.enemies, ri)).toBe(1);
    expect(activePickupCount(s.pickups)).toBe(0);
  });
});
