/**
 * Depth-1 boss difficulty carve-out (feel tuning). Depth 1 (the single-phase
 * gimmick-1 intro) uses flat gentle HP/damage overrides; depth >= 2 keeps the
 * EXACT 7c curve. These tests pin BOTH so the carve-out can't silently flatten
 * the depth curve, and confirm the HP bar / 50% gate (createBossState.maxHealth)
 * read the depth-1 value.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { spawnEnemy } from '../Enemy';
import {
  bossDamageForDepth,
  bossHpForDepth,
  damageMultForDepth,
  healthMultForDepth,
} from '../Difficulty';
import { createBossState } from '../Boss';
import { BOSS, ENEMY_TYPES, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

describe('Depth-1 boss carve-out (gentle intro)', () => {
  it('depth-1 HP + damage use the flat overrides', () => {
    expect(bossHpForDepth(1)).toBe(BOSS.depth1Health);
    expect(bossDamageForDepth(1)).toBe(BOSS.depth1Damage);
  });

  it('pins the gentle teaching-boss values concretely (HP 140, damage 9 — the feel tune)', () => {
    // Concrete literals (not self-referential) so an accidental drift of the carve-out
    // constants fails here. Damage was nudged 12 -> 9 (#103 fixed readability; this gives
    // a fresh player survival headroom to LEARN the weak-side dance). HP is unchanged.
    expect(BOSS.depth1Health).toBe(140);
    expect(BOSS.depth1Damage).toBe(9);
  });

  it('createBossState.maxHealth at depth 1 is the gentle value (HP bar / 50% gate source)', () => {
    expect(createBossState(0, 1).maxHealth).toBe(BOSS.depth1Health);
  });
});

describe('Depth 2+ is BYTE-IDENTICAL to the unchanged 7c curve', () => {
  it('depth-2 HP + damage = base × 7c mult (the carve-out does NOT flatten the curve)', () => {
    expect(bossHpForDepth(2)).toBeCloseTo(ENEMY_TYPES.boss.maxHealth * healthMultForDepth(2), 9);
    expect(bossDamageForDepth(2)).toBeCloseTo(ENEMY_TYPES.boss.attackDamage * damageMultForDepth(2), 9);
    // And concretely: 220 × 1.18 = 259.6, 20 × 1.12 = 22.4 (today's values).
    expect(bossHpForDepth(2)).toBeCloseTo(259.6, 9);
    expect(bossDamageForDepth(2)).toBeCloseTo(22.4, 9);
  });

  it('depth 3+ also stays on the curve (only depth 1 is carved out)', () => {
    for (const d of [3, 4, 5]) {
      expect(bossHpForDepth(d)).toBeCloseTo(ENEMY_TYPES.boss.maxHealth * healthMultForDepth(d), 9);
      expect(bossDamageForDepth(d)).toBeCloseTo(ENEMY_TYPES.boss.attackDamage * damageMultForDepth(d), 9);
    }
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

describe('Spawned depth-1 boss carries the gentle stats', () => {
  it('the live boss Enemy at depth 1 has HP 140 and damage 9 (overrides applied at spawn)', () => {
    const s = createGameState(); // depth 1
    expect(s.run.depth).toBe(1);
    for (let i = 1; i < s.rooms.length; i++) if (i !== s.bossRoom) s.rooms[i].phase = 'cleared';
    placeInRoom(s, s.bossRoom);
    update(s, idle(), DT);
    const bossE = s.enemies[s.boss!.slot];
    expect(bossE.type).toBe('boss');
    expect(bossE.health).toBe(BOSS.depth1Health); // not 220 × 1.0
    expect(bossE.attackDamage).toBe(BOSS.depth1Damage); // not 20 × 1.0
    expect(s.boss!.maxHealth).toBe(BOSS.depth1Health); // bar + phase gate agree
  });

  it('a depth-2 boss spawn keeps the curve HP/damage (no carve-out)', () => {
    // Spawn a boss directly at depth 2 + mirror the Encounter override path.
    const s = createGameState();
    for (const e of s.enemies) e.active = false;
    spawnEnemy(s.enemies, 20, 20, 2, 'boss', s.bossRoom);
    const bossE = s.enemies.find((e) => e.active && e.type === 'boss')!;
    bossE.health = bossHpForDepth(2);
    bossE.attackDamage = bossDamageForDepth(2);
    expect(bossE.health).toBeCloseTo(259.6, 9);
    expect(bossE.attackDamage).toBeCloseTo(22.4, 9);
  });
});
