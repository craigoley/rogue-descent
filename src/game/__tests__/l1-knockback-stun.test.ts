/**
 * L1 integration scenario (b) — KNOCKBACK stun (II) + AoE (III), end-to-end through
 * the real update() loop (player melee → meleeAttack → stun/force → updateEnemies
 * freezes the AI). Mirrors the unit-level proofs in knockback-stun-aoe.test (#53);
 * this is the through-the-loop version that gates the integration.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { spawnEnemy } from '../Enemy';
import { createBossState } from '../Boss';
import { KNOCKBACK_LEVELS, SIM_DT } from '../../utils/constants';
import { intent, idle } from './l1-harness';

const DT = SIM_DT;

/** Fresh state in an OPEN (wall-free) room so knockback moves enemies freely; the
 *  player at (10,10) facing +x, pools cleared, no active room (no rect clamp). */
function arena(): GameState {
  const s = createGameState();
  for (const e of s.enemies) e.active = false;
  for (const p of s.projectiles) p.active = false;
  const W = 40;
  const H = 40;
  s.room = { tilesX: W, tilesY: H, tileSize: 1, walls: [], solid: new Array<boolean>(W * H).fill(false) };
  s.activeRoom = -1;
  s.player.x = 10;
  s.player.y = 10;
  s.player.facingX = 1;
  s.player.facingY = 0;
  return s;
}

describe('L1 integration: knockback stun (#53 end-to-end)', () => {
  it('a knockback-II melee STUNS the hit enemy: AI frozen yet still shoved', () => {
    const s = arena();
    s.player.knockbackLevel = 2;
    spawnEnemy(s.enemies, 11, 10, 1, 'chaser', -1); // dead ahead (+x), in arc + reach
    const e = s.enemies.find((x) => x.active)!;
    const x0 = e.x;

    // One real frame: meleeAttack (stun + force) runs, THEN updateEnemies sees the
    // stun and freezes the AI while still integrating knockback.
    update(s, intent({ aimX: 1, aimY: 0, melee: true }), DT);

    expect(e.stunTimer).toBeGreaterThan(0); // stunned by the hit (decremented one frame)
    // Shoved +x (away from the player at x=10) — a NON-stunned chaser would chase
    // -x toward the player, so x increasing proves AI frozen + knockback integrated.
    expect(e.x).toBeGreaterThan(x0);
  });

  it('the stun keeps the AI frozen across frames until it expires', () => {
    const s = arena();
    s.player.knockbackLevel = 2;
    spawnEnemy(s.enemies, 11, 10, 1, 'chaser', -1);
    const e = s.enemies.find((x) => x.active)!;
    update(s, intent({ aimX: 1, aimY: 0, melee: true }), DT); // stun + shove
    e.kbVx = 0; // isolate AI movement from residual knockback
    e.kbVy = 0;
    const xMid = e.x;
    update(s, idle(), DT); // still stunned -> AI frozen -> no chase toward the player
    expect(e.x).toBeCloseTo(xMid, 9); // did not move (frozen, kb zeroed)
    expect(e.stunTimer).toBeGreaterThan(0);
  });

  it('knockback-III AoE shoves + stuns an OUT-OF-ARC in-range enemy with NO damage', () => {
    const s = arena();
    s.player.knockbackLevel = 3;
    const inArc = (spawnEnemy(s.enemies, 11, 10, 1, 'chaser', -1), s.enemies.find((x) => x.active)!);
    spawnEnemy(s.enemies, 9, 10, 1, 'chaser', -1); // BEHIND the player (-x), within aoeRadius
    const behind = s.enemies.filter((x) => x.active)[1];
    const inArcHp = inArc.health;
    const behindHp = behind.health;

    update(s, intent({ aimX: 1, aimY: 0, melee: true }), DT);

    expect(inArc.health).toBeLessThan(inArcHp); // in-arc takes damage
    expect(behind.health).toBe(behindHp); // out-of-arc takes NO damage (crowd-control)
    expect(behind.stunTimer).toBeGreaterThan(0); // ...but is stunned
    expect(Math.abs(behind.kbVx) + Math.abs(behind.kbVy)).toBeGreaterThan(0); // ...and shoved
  });

  it('the boss is STUN-IMMUNE but still takes the knockback force', () => {
    const s = arena();
    s.player.knockbackLevel = 3;
    spawnEnemy(s.enemies, 12, 10, 1, 'boss', s.bossRoom); // ahead; boss radius 1.4 -> in reach
    const boss = s.enemies.find((x) => x.active && x.type === 'boss')!;
    s.boss = createBossState(s.enemies.indexOf(boss), 1);
    s.boss.vulnerableAngle = Math.PI; // weak side faces the player (-x) so the hit lands

    update(s, intent({ aimX: 1, aimY: 0, melee: true }), DT);

    expect(boss.stunTimer).toBe(0); // never stunned (immune)
    expect(Math.abs(boss.kbVx) + Math.abs(boss.kbVy)).toBeGreaterThan(0); // force still applies
    expect(KNOCKBACK_LEVELS.force[3]).toBeGreaterThan(0); // (sanity: level 3 force is real)
  });
});
