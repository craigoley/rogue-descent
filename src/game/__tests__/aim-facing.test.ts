/**
 * Twin-stick facing contract (pure layer). Pins BOTH branches so neither can
 * silently break again (the #25 regression made the movement-fallback unreachable
 * by never returning aim to idle):
 *   - AIM ACTIVE: aimDirection follows the aim vector, overriding facing.
 *   - AIM IDLE: aimDirection falls back to player.facing, which tracks the last
 *     MOVEMENT direction — so melee fires where you're moving.
 * The input-layer half (aim actually returning to idle on touch) is pinned in
 * src/input/__tests__/controls-aim-idle.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { aimDirection } from '../Combat';
import { createIntent, isoRotate } from '../Input';
import { spawnEnemy } from '../Enemy';
import { SIM_DT, TUNING } from '../../utils/constants';

const DT = SIM_DT;

/** Fresh state with the enemy pool emptied (combat tests own their spawns). */
function arena(): GameState {
  const s = createGameState();
  for (const e of s.enemies) e.active = false;
  return s;
}

describe('aimDirection — the two facing branches', () => {
  it('AIM IDLE falls back to player.facing', () => {
    const s = arena();
    s.player.facingX = 0.6;
    s.player.facingY = 0.8; // already unit
    const out = aimDirection(s.player, createIntent(), { x: 0, y: 0 });
    expect(out.x).toBeCloseTo(0.6, 9);
    expect(out.y).toBeCloseTo(0.8, 9);
  });

  it('AIM ACTIVE overrides facing with the (iso-rotated, normalised) aim', () => {
    const s = arena();
    s.player.facingX = 1; // facing +x ...
    s.player.facingY = 0;
    const intent = { ...createIntent(), aimX: -1, aimY: 0 }; // ... but aim points elsewhere
    const out = aimDirection(s.player, intent, { x: 0, y: 0 });
    // Expected = normalised iso-rotation of the aim input (what the sim uses).
    const r = isoRotate(intent.aimX, intent.aimY);
    const len = Math.hypot(r.x, r.y);
    expect(out.x).toBeCloseTo(r.x / len, 9);
    expect(out.y).toBeCloseTo(r.y / len, 9);
    // And it is NOT the facing vector (the override actually happened).
    expect(Math.hypot(out.x - 1, out.y - 0)).toBeGreaterThan(0.1);
  });
});

describe('movement -> facing -> melee (the fallback, end-to-end)', () => {
  it('with aim idle, moving sets facing and melee fires along the move direction', () => {
    const s = arena();
    // One tick of pure movement input (no aim): facing tracks the move dir.
    update(s, { ...createIntent(), moveX: 1, moveY: 0 }, DT);
    const fx = s.player.facingX;
    const fy = s.player.facingY;
    expect(Math.hypot(fx, fy)).toBeCloseTo(1, 6); // facing is a real unit dir

    // Enemy IN the facing direction (in range), and one BEHIND it.
    spawnEnemy(s.enemies, s.player.x + fx * 1.0, s.player.y + fy * 1.0);
    spawnEnemy(s.enemies, s.player.x - fx * 1.0, s.player.y - fy * 1.0);
    const front = s.enemies.find((e) => e.active)!;
    const back = s.enemies.filter((e) => e.active)[1];
    const frontHp = front.health;
    const backHp = back.health;

    // Melee with aim IDLE: aimDirection -> facing -> the swing goes along movement.
    update(s, { ...createIntent(), melee: true }, DT);

    expect(front.health).toBe(frontHp - TUNING.meleeDamage); // hit where we moved
    expect(back.health).toBe(backHp); // the one behind is outside the forward arc
  });
});
