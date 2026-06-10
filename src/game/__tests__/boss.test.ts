/**
 * Boss framework + gimmick #1 (Phase 8). Pins the BEHAVIOUR contract:
 *   - PHASE escalation: two-phase bosses flip at <= 50% HP; single-phase never do.
 *   - GIMMICK #1 directional shield: damage lands from the VULNERABLE side, is
 *     BLOCKED from the armored side.
 *   - DEPTH scaling: HP + damage scale with depth; phase count is depth-gated.
 *   - GATING: the boss room spawns a single boss alone, and the boss's DEATH
 *     clears the room -> opens descent (stairs pinned to the boss room).
 *   - GENERATION: the boss room is deterministic, reachable, and boss-sized.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { spawnEnemy } from '../Enemy';
import { generateDungeon } from '../Dungeon';
import { buildEncounters } from '../Encounter';
import { createBossState, updateBoss, bossVulnerable } from '../Boss';
import { damageEnemy } from '../Combat';
import {
  bossPhasesForDepth,
  damageMultForDepth,
  healthMultForDepth,
} from '../Difficulty';
import { activeParticleCount } from '../Particle';
import { BOSS, BOSS_DEATH, DUNGEON, ENEMY_TYPES, SHAKE, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;
const SCRATCH = { x: 0, y: 0 };

/** Spawn a boss into a fresh state at `depth`; return {state, enemy}. */
function bossState(depth: number): { s: GameState; e: GameState['enemies'][number] } {
  const s = createGameState();
  for (const en of s.enemies) en.active = false;
  expect(spawnEnemy(s.enemies, 20, 20, depth, 'boss', s.bossRoom)).toBe(true);
  const slot = s.enemies.findIndex((en) => en.active && en.type === 'boss');
  s.boss = createBossState(slot, depth);
  return { s, e: s.enemies[slot] };
}

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

describe('Boss — phase escalation at 50% HP', () => {
  it('a TWO-phase boss (deep) flips to phase 2 only once HP <= 50%', () => {
    const { s, e } = bossState(3);
    expect(s.boss!.phases).toBe(2);
    expect(s.boss!.outerPhase).toBe(1);

    // Above the threshold: stays phase 1.
    e.health = s.boss!.maxHealth * 0.6;
    updateBoss(e, s, DT, 10, 0, 10, SCRATCH);
    expect(s.boss!.outerPhase).toBe(1);

    // At/under 50%: flips to phase 2 (one-way).
    e.health = s.boss!.maxHealth * 0.5;
    updateBoss(e, s, DT, 10, 0, 10, SCRATCH);
    expect(s.boss!.outerPhase).toBe(2);
  });

  it('a SINGLE-phase boss (shallow) NEVER flips, even near death', () => {
    const { s, e } = bossState(1);
    expect(s.boss!.phases).toBe(1);
    e.health = 1; // almost dead
    updateBoss(e, s, DT, 10, 0, 10, SCRATCH);
    expect(s.boss!.outerPhase).toBe(1);
  });
});

describe('Boss — gimmick #1 directional shield (damageEnemy)', () => {
  it('a hit from the VULNERABLE side lands full damage', () => {
    const { s, e } = bossState(1);
    s.boss!.vulnerableAngle = 0; // weak-point faces +x (world)
    const hp0 = e.health;
    // Attacker stands at +x of the boss -> hit direction (attacker->boss) is -x.
    damageEnemy(e, 50, -1, 0, 0, s);
    expect(e.health).toBe(hp0 - 50);
    expect(s.boss!.blockedFlash).toBe(0); // not a blocked hit
  });

  it('a hit from the ARMORED side is BLOCKED (no damage, shield flash)', () => {
    const { s, e } = bossState(1);
    s.boss!.vulnerableAngle = 0;
    const hp0 = e.health;
    // Attacker stands at -x -> hit direction is +x: the armored side.
    damageEnemy(e, 50, 1, 0, 0, s);
    expect(e.health).toBe(hp0); // fully negated (blockedDamageMult 0)
    expect(s.boss!.blockedFlash).toBeGreaterThan(0); // shield tell fired
  });

  it('bossVulnerable agrees with the arc geometry', () => {
    // Weak-point faces +x; the half-arc is BOSS.vulnerableArc/2.
    expect(bossVulnerable(0, -1, 0)).toBe(true); // dead-on the weak side
    expect(bossVulnerable(0, 1, 0)).toBe(false); // dead-on the armored side
    // A hit just inside the arc edge is vulnerable; just outside is not.
    const half = BOSS.vulnerableArc / 2;
    const inAng = half - 0.05;
    const outAng = half + 0.05;
    // attacker at angle A from boss => hitDir = -(cosA, sinA).
    expect(bossVulnerable(0, -Math.cos(inAng), -Math.sin(inAng))).toBe(true);
    expect(bossVulnerable(0, -Math.cos(outAng), -Math.sin(outAng))).toBe(false);
  });
});

describe('Boss — depth scaling', () => {
  it('phase count is depth-gated at bossTwoPhaseMinDepth', () => {
    expect(bossPhasesForDepth(1)).toBe(1);
    expect(bossPhasesForDepth(2)).toBe(1); // depth 2 still single-phase
    expect(bossPhasesForDepth(3)).toBe(2);
    expect(bossPhasesForDepth(7)).toBe(2);
  });

  it('HP and damage scale UP with depth (and HP matches the companion state)', () => {
    const shallow = bossState(1);
    const deep = bossState(4);
    // Deeper boss is tougher + hits harder.
    expect(deep.e.health).toBeGreaterThan(shallow.e.health);
    expect(deep.e.attackDamage).toBeGreaterThan(shallow.e.attackDamage);
    // The companion maxHealth equals the spawned Enemy health (the 50% gate +
    // HP bar both read it).
    expect(deep.s.boss!.maxHealth).toBeCloseTo(deep.e.health, 9);
    // Curves match the shared difficulty multipliers.
    expect(deep.e.health).toBeCloseTo(
      ENEMY_TYPES.boss.maxHealth * healthMultForDepth(4),
      9,
    );
    expect(deep.e.attackDamage).toBeCloseTo(
      ENEMY_TYPES.boss.attackDamage * damageMultForDepth(4),
      9,
    );
  });
});

describe('Boss — room spawn + descent gating', () => {
  it('the boss room has NO normal spawns (boss-alone)', () => {
    const floor = generateDungeon(DUNGEON.defaultSeed);
    const encs = buildEncounters(floor, 3);
    expect(encs[floor.bossRoom].spawns).toHaveLength(0);
    // A non-boss, non-spawn room still has its normal spawns.
    const normal = encs.findIndex((_, i) => i !== 0 && i !== floor.bossRoom);
    expect(encs[normal].spawns.length).toBeGreaterThan(0);
  });

  it('entering the boss room spawns a SINGLE boss; its death opens descent', () => {
    const s = createGameState();
    const bossRoom = s.bossRoom;
    // Clear every other room so all-cleared depends solely on the boss.
    for (let i = 1; i < s.rooms.length; i++) {
      if (i !== bossRoom) s.rooms[i].phase = 'cleared';
    }

    placeInRoom(s, bossRoom);
    update(s, idle(), DT);
    expect(s.rooms[bossRoom].phase).toBe('active');
    expect(s.boss).not.toBeNull();
    const bossSlot = s.boss!.slot;
    expect(s.enemies[bossSlot].type).toBe('boss');
    // Exactly ONE active enemy (the boss, alone).
    expect(s.enemies.filter((e) => e.active)).toHaveLength(1);
    expect(s.stairs.active).toBe(false); // gated: boss still alive

    // Park the player at spawn so the clear frame doesn't auto-descend.
    s.player.x = s.spawn.x;
    s.player.y = s.spawn.y;
    s.enemies[bossSlot].active = false; // boss dies
    update(s, idle(), DT);

    expect(s.boss).toBeNull(); // companion cleared on death
    expect(s.rooms[bossRoom].phase).toBe('cleared');
    expect(s.stairs.active).toBe(true); // all rooms cleared -> descent open
    expect(s.stairs.roomIndex).toBe(bossRoom); // stairs pinned to the boss room

    // Drain the brief boss-death celebration hit-stop (the slow-mo beat freezes the
    // sim) before stepping onto the stairs — mirrors real play (celebrate, then walk).
    while (s.hitstopTimer > 0) update(s, idle(), DT);
    // Stepping on the stairs descends.
    s.player.x = s.stairs.x;
    s.player.y = s.stairs.y;
    update(s, idle(), DT);
    expect(s.run.depth).toBe(2);
  });

  it('boss death fires the ONE-SHOT celebration (big shake + slow-mo + burst), boss-exclusive', () => {
    const s = createGameState();
    const bossRoom = s.bossRoom;
    for (let i = 1; i < s.rooms.length; i++) {
      if (i !== bossRoom) s.rooms[i].phase = 'cleared';
    }
    placeInRoom(s, bossRoom);
    update(s, idle(), DT); // activate the boss room
    const bossSlot = s.boss!.slot;

    // A normal hit on the boss does NOT trigger the celebration (boss still alive).
    for (const pk of s.pickups) pk.active = false;
    s.shakeTimer = 0;
    s.player.x = s.spawn.x; // park away from the stairs
    s.player.y = s.spawn.y;
    s.enemies[bossSlot].active = false; // boss dies THIS frame
    update(s, idle(), DT);

    // Big shake (bigger + longer than a player hit) + slow-mo hit-stop (longer than
    // crit) + a big multi-wave burst — all one-shot on the boss-death frame.
    expect(s.shakeTimer).toBeGreaterThan(SHAKE.duration); // bigger than a player-hit shake
    expect(s.hitstopTimer).toBe(BOSS_DEATH.hitstop); // the slow-mo beat is armed
    expect(activeParticleCount(s.particles)).toBeGreaterThanOrEqual(BOSS_DEATH.burstCount);
    // The mechanical outcome is unchanged: descent is unlocked.
    expect(s.bossDefeated).toBe(true);
    expect(s.stairs.active).toBe(true);
  });
});

describe('Boss — room designation (generation)', () => {
  it('is deterministic, never the spawn room, in range, and boss-sized + reachable', () => {
    for (const seed of [1, 2, 3, 42, 100, 777, 31337]) {
      const a = generateDungeon(seed);
      const b = generateDungeon(seed);
      expect(a.bossRoom).toBe(b.bossRoom); // deterministic per seed
      expect(a.bossRoom).toBeGreaterThan(0); // never the spawn room (rooms[0])
      expect(a.bossRoom).toBeLessThan(a.rooms.length);

      const r = a.rooms[a.bossRoom];
      // Big enough to host the boss (the fit filter).
      expect(Math.min(r.w, r.h)).toBeGreaterThanOrEqual(DUNGEON.bossMinRoomSide);
      // Reachable from the spawn room: flood-fill over walkable cells reaches the
      // boss room centre (generation guarantees full connectivity).
      expect(reaches(a, 0, a.bossRoom)).toBe(true);
    }
  });
});

/** Flood-fill from room `from`'s centre over walkable cells; does it reach room
 *  `to`'s centre? Proves the boss room is actually playable-reachable. */
function reaches(
  floor: ReturnType<typeof generateDungeon>,
  from: number,
  to: number,
): boolean {
  const { tilesX, tilesY, solid } = floor.room;
  const cell = (r: { x: number; y: number; w: number; h: number }) => ({
    tx: Math.floor(r.x + r.w / 2),
    ty: Math.floor(r.y + r.h / 2),
  });
  const start = cell(floor.rooms[from]);
  const goal = cell(floor.rooms[to]);
  const seen = new Array<boolean>(tilesX * tilesY).fill(false);
  const idx = (tx: number, ty: number) => ty * tilesX + tx;
  if (solid[idx(start.tx, start.ty)] || solid[idx(goal.tx, goal.ty)]) return false;
  const queue = [start];
  seen[idx(start.tx, start.ty)] = true;
  for (let h = 0; h < queue.length; h++) {
    const { tx, ty } = queue[h];
    if (tx === goal.tx && ty === goal.ty) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= tilesX || ny >= tilesY) continue;
      if (seen[idx(nx, ny)] || solid[idx(nx, ny)]) continue;
      seen[idx(nx, ny)] = true;
      queue.push({ tx: nx, ty: ny });
    }
  }
  return false;
}
