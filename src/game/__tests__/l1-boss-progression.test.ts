/**
 * L1 integration scenario (a) — the BOSS PROGRESSION SPINE, end-to-end through the
 * real loop: a seeded run spawns the floor boss; the player KILLS it with scripted
 * melee through update(); the boss-death → bossDefeated → stairs-open → descend
 * chain fires. This is the spine — if it silently breaks, the game is unbeatable,
 * so it gates every future PR (the claude-review pipeline runs `npm test`).
 *
 * The rotating shield (gimmick #1) is neutralised deterministically by pinning the
 * weak-point at the player each frame so the scripted swings land — the shield
 * mechanic itself is covered in boss.test; here we exercise the KILL → DESCENT
 * chain via the genuine meleeAttack → damageEnemy → death-hook → resolve →
 * descendIfReady path.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, startNewRun, update, type GameState } from '../GameState';
import { MELEE, ENEMY_TYPES, SIM_DT, DESCENT } from '../../utils/constants';
import { intent, placeInRoom } from './l1-harness';

const DT = SIM_DT;
const SEED = 12345;

/** Activate the boss room (real encounter path) and return the live boss Enemy. */
function spawnFloorBoss(s: GameState) {
  const bossRoom = s.bossRoom;
  placeInRoom(s, bossRoom);
  update(s, intent(), DT); // entering the boss room spawns the boss
  expect(s.boss).not.toBeNull();
  return s.enemies[s.boss!.slot];
}

describe('L1 integration: boss progression spine (kill → descend)', () => {
  it('a seeded run can spawn the boss, kill it with melee, and descend to depth 2', () => {
    const s = createGameState();
    startNewRun(s, SEED); // deterministic floor
    expect(s.run.depth).toBe(1);

    const bossE = spawnFloorBoss(s);
    expect(bossE.type).toBe('boss');
    const bossRoom = s.bossRoom;

    // A maxed-melee build so the kill is a few landing swings (fast + the boss
    // barely gets to slam back — the player survives deterministically).
    s.player.meleeLevel = 3;

    // Kill loop: each frame stand within melee reach on the boss's -x side, pin the
    // weak-point toward the player so the swing lands, and swing (the sim self-gates
    // on the melee cooldown). Explicit loop — it controls per-frame test state
    // (boss orientation + player position), which runFrames (input-only) doesn't.
    const reach = MELEE.range + ENEMY_TYPES.boss.radius; // hit connects within this of centre
    let frames = 0;
    const CAP = 1200; // 20s of sim — generous; assert we kill well before it
    while (bossE.active && frames < CAP) {
      s.player.x = bossE.x - reach * 0.6; // inside reach, not overlapping the body
      s.player.y = bossE.y;
      if (s.boss) s.boss.vulnerableAngle = Math.PI; // weak side faces the player (-x)
      update(s, intent({ aimX: 1, aimY: 0, melee: true }), DT);
      frames += 1;
    }
    expect(bossE.active).toBe(false); // the boss died from scripted melee
    expect(frames).toBeLessThan(CAP);

    // THE CHAIN — the moment the boss died, the death-hook + resolve + descendIfReady
    // ran in that same frame. The player is ~reach from the boss-room centre (where
    // the stairs pin), i.e. outside DESCENT.contactRadius, so it has NOT descended yet.
    expect(s.bossDefeated).toBe(true);
    expect(s.stairs.active).toBe(true);
    expect(s.stairs.roomIndex).toBe(bossRoom);
    expect(s.run.depth).toBe(1); // chain opened the stairs but didn't auto-descend
    // (sanity: the player really is out of stair contact this frame)
    expect(Math.hypot(s.player.x - s.stairs.x, s.player.y - s.stairs.y)).toBeGreaterThan(
      DESCENT.contactRadius,
    );

    // Step onto the (boss-room-pinned) stairs → descend. Clear the kill's hit-stop
    // freeze first so this frame actually runs (not testing hit-stop here).
    s.hitstopTimer = 0;
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    update(s, intent(), DT);
    expect(s.run.depth).toBe(2); // DESCENDED — the spine is whole
    // Fresh floor re-armed its own boss gate.
    expect(s.bossDefeated).toBe(false);
    expect(s.stairs.active).toBe(false);
  });

  it('descent is gated on the boss: stairs stay shut until it dies', () => {
    const s = createGameState();
    startNewRun(s, SEED);
    spawnFloorBoss(s); // boss alive, not yet killed
    expect(s.bossDefeated).toBe(false);
    expect(s.stairs.active).toBe(false);
    // Standing where the stairs would pin does NOT descend while the boss lives.
    const r = s.rooms[s.bossRoom].rect;
    s.player.x = (r.x + r.w / 2) * s.room.tileSize;
    s.player.y = (r.y + r.h / 2) * s.room.tileSize;
    update(s, intent(), DT);
    expect(s.run.depth).toBe(1);
  });
});
