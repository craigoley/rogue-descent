/**
 * Boss gimmick #2 — ADDS (Phase 8). Pins the contract:
 *   - SUMMON spawns a FINITE wave of weak adds in a line (pierce-friendly),
 *     tagged to the boss room, deterministically.
 *   - GATED re-summon: no new wave while one is alive (no instant respawn / drip).
 *   - Phase/depth gating: summon is phase-2-only, so single-phase (depth<3) adds
 *     bosses never summon; positioning bosses never summon; first summoning boss
 *     is depth 5 (with the 3-gimmick roster: positioning / adds / knockback).
 *   - THE KEY GATING TEST: the boss's DEATH clears the room EVEN WITH adds alive
 *     (adds despawn) and opens descent — adds aren't a kill-everything grind, and
 *     despawned adds aren't counted as kills / don't roll drops.
 *   - Pool capacity: boss + wave <= POOL.enemies; summon respects a full pool.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, consumeBossSummon, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { spawnEnemy, roomEnemyCount, activeEnemyCount } from '../Enemy';
import { createBossState, updateBoss } from '../Boss';
import { damageEnemy } from '../Combat';
import { bossGimmickForDepth, bossPhasesForDepth } from '../Difficulty';
import { BOSS, POOL, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;
const SCRATCH = { x: 0, y: 0 };

/** A state with one boss spawned at (bx,by), tagged to bossRoom, with companion
 *  state for `depth`. Pool otherwise empty. */
function withBoss(depth: number, bx = 20, by = 20): { s: GameState; e: GameState['enemies'][number] } {
  const s = createGameState();
  for (const en of s.enemies) en.active = false;
  s.bossRoom = 1;
  spawnEnemy(s.enemies, bx, by, depth, 'boss', s.bossRoom);
  const slot = s.enemies.findIndex((en) => en.active && en.type === 'boss');
  s.boss = createBossState(slot, depth);
  return { s, e: s.enemies[slot] };
}

/** Force the boss into a SUMMON strike this tick (adds gimmick, phase 2, the
 *  SUMMON entry of [SLAM, SUMMON]) with the player along +x for a known line.
 *  Drives the FULL signal path: updateBoss RECORDS the request, then
 *  consumeBossSummon performs the spawn (exactly as `update` does). */
function fireSummon(s: GameState, e: GameState['enemies'][number]): void {
  const boss = s.boss!;
  boss.gimmick = 'adds';
  boss.outerPhase = 2;
  boss.attackCursor = 1; // index 1 of [SLAM, SUMMON] -> SUMMON
  e.health = boss.maxHealth;
  e.phase = 'strike';
  e.struck = false;
  e.timer = 1;
  s.player.x = e.x + 5;
  s.player.y = e.y;
  const dx = s.player.x - e.x;
  const dy = s.player.y - e.y;
  updateBoss(e, s, DT, dx, dy, Math.hypot(dx, dy), SCRATCH);
  consumeBossSummon(s); // the spawn side-effect (GameState owns it)
}

const addsOf = (s: GameState) => s.enemies.filter((e) => e.active && e.type === 'bossadd');

describe('SUMMON — finite, line-shaped, deterministic wave', () => {
  it('spawns exactly BOSS.summon.count adds, tagged to the boss room', () => {
    const { s, e } = withBoss(4);
    fireSummon(s, e);
    const adds = addsOf(s);
    expect(adds).toHaveLength(BOSS.summon.count);
    expect(adds.every((a) => a.roomIndex === s.bossRoom)).toBe(true);
    expect(adds.every((a) => a.type === 'bossadd')).toBe(true);
  });

  it('places the wave in a LINE on the boss->player axis (pierce-friendly), deterministic', () => {
    const { s, e } = withBoss(4, 20, 20); // player at +x -> line runs along +x
    fireSummon(s, e);
    const adds = addsOf(s).sort((a, b) => a.x - b.x);
    for (let k = 0; k < adds.length; k++) {
      expect(adds[k].x).toBeCloseTo(20 + BOSS.summon.lineOffset + k * BOSS.summon.lineSpacing, 9);
      expect(adds[k].y).toBeCloseTo(20, 9); // colinear -> one pierce shot can skewer them
    }
  });
});

describe('SUMMON signal — boss records intent, GameState performs the spawn', () => {
  it('updateBoss RECORDS pendingSummon without spawning; consume spawns + clears it', () => {
    const { s, e } = withBoss(4);
    s.boss!.gimmick = 'adds';
    s.boss!.outerPhase = 2;
    s.boss!.attackCursor = 1; // SUMMON
    e.health = s.boss!.maxHealth;
    e.phase = 'strike';
    e.struck = false;
    e.timer = 1;
    s.player.x = e.x + 5;
    s.player.y = e.y;
    updateBoss(e, s, DT, 5, 0, 5, SCRATCH);

    // The strike only RECORDED intent — Boss spawned nothing (no spawnEnemy import).
    expect(s.boss!.pendingSummon).not.toBeNull();
    expect(s.boss!.pendingSummon!.count).toBe(BOSS.summon.count);
    expect(addsOf(s)).toHaveLength(0);

    // GameState consumes the request: spawns the wave, then clears it.
    consumeBossSummon(s);
    expect(addsOf(s)).toHaveLength(BOSS.summon.count);
    expect(s.boss!.pendingSummon).toBeNull();
  });

  it('the gated guard records NO request while a wave is alive', () => {
    const { s, e } = withBoss(4);
    fireSummon(s, e); // a wave of 3 is now alive
    expect(addsOf(s)).toHaveLength(BOSS.summon.count);
    // A second SUMMON strike while the wave lives must not even record a request.
    s.boss!.attackCursor = 1;
    e.phase = 'strike';
    e.struck = false;
    e.timer = 1;
    updateBoss(e, s, DT, 5, 0, 5, SCRATCH);
    expect(s.boss!.pendingSummon).toBeNull();
  });
});

describe('GATED re-summon — never more than one wave alive', () => {
  it('a second summon while the wave lives is a no-op', () => {
    const { s, e } = withBoss(4);
    fireSummon(s, e);
    expect(addsOf(s)).toHaveLength(BOSS.summon.count);
    fireSummon(s, e); // wave still alive -> gated
    expect(addsOf(s)).toHaveLength(BOSS.summon.count); // NOT doubled
  });

  it('re-summons once the previous wave is cleared', () => {
    const { s, e } = withBoss(4);
    fireSummon(s, e);
    for (const a of addsOf(s)) a.active = false; // player cleared the wave
    fireSummon(s, e);
    expect(addsOf(s)).toHaveLength(BOSS.summon.count); // a fresh wave
  });
});

describe('Phase / depth gating — shallow + positioning bosses never summon', () => {
  it('a PHASE-1 adds boss never summons (summon is phase-2-only)', () => {
    const { s, e } = withBoss(2); // depth 2: adds gimmick BUT single-phase
    expect(s.boss!.gimmick).toBe('adds');
    expect(s.boss!.phases).toBe(1);
    // Drive several full attack cycles in phase 1; the table is [SLAM] only.
    s.player.x = e.x + 5;
    s.player.y = e.y;
    for (let i = 0; i < 600; i++) {
      const dx = s.player.x - e.x;
      const dy = s.player.y - e.y;
      updateBoss(e, s, DT, dx, dy, Math.hypot(dx, dy), SCRATCH);
    }
    expect(s.boss!.pendingSummon).toBeNull(); // never even REQUESTED a summon
    consumeBossSummon(s);
    expect(addsOf(s)).toHaveLength(0); // ...so no adds spawn
  });

  it('a POSITIONING boss never summons (no SUMMON in its table)', () => {
    const { s, e } = withBoss(4); // depth 4: positioning, two-phase (depth 3 is now knockback)
    expect(s.boss!.gimmick).toBe('positioning');
    s.boss!.outerPhase = 2; // even in phase 2
    e.phase = 'strike';
    e.struck = false;
    e.timer = 1;
    s.player.x = e.x + 5;
    s.player.y = e.y;
    updateBoss(e, s, DT, 5, 0, 5, SCRATCH);
    expect(s.boss!.pendingSummon).toBeNull(); // no request recorded
    consumeBossSummon(s);
    expect(addsOf(s)).toHaveLength(0);
  });

  it('rotation cadence: first SUMMONING boss is depth 5 (3-gimmick roster)', () => {
    // depth 1 positioning; depth 2 adds-but-single-phase; depth 3 knockback(2ph);
    // depth 4 positioning(2ph); depth 5 adds + two-phase = the first boss that summons.
    expect(bossGimmickForDepth(1)).toBe('positioning');
    expect(bossGimmickForDepth(2)).toBe('adds');
    expect(bossPhasesForDepth(2)).toBe(1); // single-phase -> never summons
    expect(bossGimmickForDepth(3)).toBe('knockback'); // gimmick #3 first appears here
    expect(bossGimmickForDepth(4)).toBe('positioning');
    expect(bossGimmickForDepth(5)).toBe('adds');
    expect(bossPhasesForDepth(5)).toBe(2); // two-phase + adds -> SUMMONS
    // No depth < 5 is both adds-gimmick AND two-phase.
    for (let d = 1; d <= 4; d++) {
      expect(bossGimmickForDepth(d) === 'adds' && bossPhasesForDepth(d) === 2).toBe(false);
    }
  });
});

describe('Pool capacity', () => {
  it('boss + a full wave fits in POOL.enemies', () => {
    expect(1 + BOSS.summon.count).toBeLessThanOrEqual(POOL.enemies);
  });

  it('summon respects a full pool (spawnEnemy false handled, no overflow/throw)', () => {
    const { s, e } = withBoss(4);
    // Fill every remaining slot so the summon can spawn at most a couple.
    let guard = 0;
    while (activeEnemyCount(s.enemies) < POOL.enemies && guard++ < POOL.enemies) {
      spawnEnemy(s.enemies, 1, 1, 1, 'chaser', 99); // foreign filler
    }
    expect(activeEnemyCount(s.enemies)).toBe(POOL.enemies);
    expect(() => fireSummon(s, e)).not.toThrow();
    expect(activeEnemyCount(s.enemies)).toBe(POOL.enemies); // never exceeds the pool
  });
});

/** Place the player on a guaranteed ROOM-BODY (non-corridor) cell of room `i`. */
function placeInRoom(s: GameState, i: number): void {
  const r = s.rooms[i].rect;
  const room = s.room;
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (room.corridor?.[ty * room.tilesX + tx]) continue;
      s.player.x = (tx + 0.5) * room.tileSize;
      s.player.y = (ty + 0.5) * room.tileSize;
      return;
    }
  }
  s.player.x = (r.x + r.w / 2) * room.tileSize;
  s.player.y = (r.y + r.h / 2) * room.tileSize;
}

describe('KEY GATING — boss death clears the room even with adds alive', () => {
  it('despawns the wave on boss death, clears the room, opens descent; adds not counted', () => {
    const s = createGameState();
    const bossRoom = s.bossRoom;
    for (let i = 1; i < s.rooms.length; i++) if (i !== bossRoom) s.rooms[i].phase = 'cleared';

    // Activate the boss room (spawns the boss via the real encounter path).
    placeInRoom(s, bossRoom);
    update(s, idle(), DT);
    expect(s.boss).not.toBeNull();
    const bossE = s.enemies[s.boss!.slot];

    // Simulate a live summoned wave (3 adds tagged to the boss room).
    for (let k = 0; k < BOSS.summon.count; k++) {
      expect(spawnEnemy(s.enemies, bossE.x + 2 + k, bossE.y, s.run.depth, 'bossadd', bossRoom)).toBe(true);
    }
    expect(roomEnemyCount(s.enemies, bossRoom)).toBe(1 + BOSS.summon.count); // boss + adds
    expect(s.rooms[bossRoom].phase).toBe('active'); // not cleared while boss lives

    // Park the player away so the clear frame doesn't auto-descend; record tallies.
    s.player.x = s.spawn.x;
    s.player.y = s.spawn.y;
    const kills0 = s.run.kills;
    const pickups0 = activePickups(s);

    // Kill the boss outright (vulnerable-side hit so the shield doesn't block).
    s.boss!.vulnerableAngle = 0; // weak side faces +x; hit from +x => kbDir (-1,0)
    damageEnemy(bossE, bossE.health, -1, 0, 0, s);
    expect(bossE.active).toBe(false);
    s.hitstopTimer = 0; // skip the impact freeze so this frame runs the despawn (not testing hitstop)

    update(s, idle(), DT); // boss-death frame: despawn adds -> room clears

    expect(addsOf(s)).toHaveLength(0); // wave despawned
    expect(s.boss).toBeNull();
    expect(roomEnemyCount(s.enemies, bossRoom)).toBe(0);
    expect(s.rooms[bossRoom].phase).toBe('cleared'); // cleared on BOSS death
    expect(s.stairs.active).toBe(true); // descent opens (all rooms cleared)
    expect(s.stairs.roomIndex).toBe(bossRoom);

    update(s, idle(), DT); // a follow-up frame to surface any deferred counting
    // The 3 despawned adds were NOT counted as kills and rolled NO drops.
    expect(s.run.kills).toBe(kills0);
    expect(activePickups(s)).toBe(pickups0);

    // Drain the brief boss-death celebration hit-stop before stepping on the stairs.
    while (s.hitstopTimer > 0) update(s, idle(), DT);
    // And stepping on the pinned stairs descends.
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    update(s, idle(), DT);
    expect(s.run.depth).toBe(2);
  });
});

const activePickups = (s: GameState): number => s.pickups.filter((p) => p.active).length;
