import { describe, expect, it } from 'vitest';
import { createGameState, update, startNewRun, type GameState } from '../GameState';
import { createPlayer, updatePlayer } from '../Player';
import { createIntent } from '../Input';
import { applyPickup } from '../Pickup';
import { damagePlayer } from '../Combat';
import { buildTestRoom } from '../Room';
import { DASH_STRIKE, ENEMY, SIM_DT, TUNING } from '../../utils/constants';

const DT = SIM_DT;
const room = buildTestRoom();
const idle = createIntent;
/** Screen (1,1) maps through the iso yaw to a world +x dash (as in combat.test). */
const dash = (): ReturnType<typeof createIntent> => ({ ...createIntent(), moveX: 1, moveY: 1, dash: true });

/** A combat arena: no encounter rooms, all enemies off, player at a known spot. */
function arena(): GameState {
  const s = createGameState();
  for (const e of s.enemies) e.active = false;
  s.rooms = [];
  s.activeRoom = -1;
  s.player.x = 7;
  s.player.y = 7;
  return s;
}

/** Put an inert enemy at (x, y) — phase recover so it neither moves nor strikes. */
function putEnemy(s: GameState, x: number, y: number): GameState['enemies'][number] {
  const e = s.enemies[0];
  e.active = true;
  e.health = ENEMY.maxHealth;
  e.x = x;
  e.y = y;
  e.phase = 'recover';
  e.timer = 999;
  return e;
}

/** Trigger a dash and run the whole burst (world +x). */
function runDash(s: GameState): void {
  update(s, dash(), DT);
  while (s.player.dashTimer > 0) update(s, { ...createIntent(), moveX: 1, moveY: 1 }, DT);
}

/** Clear the floor and step on the stairs to descend once. */
function descendOnce(s: GameState): void {
  for (let i = 0; i < s.rooms.length; i++) s.rooms[i].phase = i === 1 ? 'active' : 'cleared';
  s.activeRoom = 1;
  s.player.x = s.spawn.x;
  s.player.y = s.spawn.y;
  update(s, idle(), DT);
  s.player.x = s.stairs.x;
  s.player.y = s.stairs.y;
  update(s, idle(), DT);
}

describe('Dash-strike — damages enemies swept by a damaging dash', () => {
  it('with the powerup, a dash through an enemy damages it (once, by DASH_STRIKE.damage)', () => {
    const s = arena();
    s.player.dashStrike = true;
    const e = putEnemy(s, 9, 7); // ahead in +x, swept by the dash
    runDash(s);
    expect(e.health).toBe(ENEMY.maxHealth - DASH_STRIKE.damage); // hit EXACTLY once
    expect(s.player.dashHits.has(0)).toBe(true);
  });

  it('without the powerup, the same dash deals NO damage', () => {
    const s = arena();
    s.player.dashStrike = false;
    const e = putEnemy(s, 9, 7);
    runDash(s);
    expect(e.health).toBe(ENEMY.maxHealth);
    expect(s.player.dashHits.size).toBe(0);
  });

  it('the per-dash hit-set resets each dash (an enemy can be hit again on the NEXT dash)', () => {
    const s = arena();
    s.player.dashStrike = true;
    const e = putEnemy(s, 9, 7);
    runDash(s); // dash 1
    expect(e.health).toBe(ENEMY.maxHealth - DASH_STRIKE.damage);

    // Re-arm: give a charge back, reset the enemy in front, dash again.
    s.player.dashCharges = 1;
    e.x = 9;
    e.y = 7;
    e.health = ENEMY.maxHealth;
    runDash(s); // dash 2
    expect(e.health).toBe(ENEMY.maxHealth - DASH_STRIKE.damage); // hit once again
  });
});

describe('Dash-strike — reduced i-frames (the risk/reward, decision B)', () => {
  it('sets a smaller i-frame window than a normal dash', () => {
    const strike = createPlayer(7, 7);
    strike.dashStrike = true;
    updatePlayer(strike, dash(), DT, room);

    const normal = createPlayer(7, 7);
    updatePlayer(normal, dash(), DT, room);

    expect(strike.iframeTimer).toBeCloseTo(TUNING.dashStrikeIframes, 9);
    expect(normal.iframeTimer).toBeCloseTo(TUNING.dashIframes, 9);
    expect(strike.iframeTimer).toBeLessThan(normal.iframeTimer);
  });

  it('an enemy strike mid-dash CAN damage during a dash-strike, but is BLOCKED during a normal dash', () => {
    // dash-strike: i-frames expire while still dashing -> a late hit lands.
    const a = arena();
    a.player.dashStrike = true;
    updatePlayer(a.player, dash(), DT, room);
    for (let i = 0; i < 4; i++) updatePlayer(a.player, idle(), DT, room);
    expect(a.player.dashTimer).toBeGreaterThan(0); // still dashing
    expect(a.player.iframeTimer).toBe(0); // reduced window already gone
    const hpA = a.player.health;
    damagePlayer(a.player, 20, a);
    expect(a.player.health).toBe(hpA - 20); // hit landed — the risk

    // normal dash: full i-frames outlast the burst -> the same hit is negated.
    const b = arena();
    b.player.dashStrike = false;
    updatePlayer(b.player, dash(), DT, room);
    for (let i = 0; i < 4; i++) updatePlayer(b.player, idle(), DT, room);
    expect(b.player.dashTimer).toBeGreaterThan(0);
    expect(b.player.iframeTimer).toBeGreaterThan(0); // still invulnerable
    const hpB = b.player.health;
    damagePlayer(b.player, 20, b);
    expect(b.player.health).toBe(hpB); // negated — the safety
  });
});

describe('Dash-strike — persistence + reset (mirrors the other powerups)', () => {
  it('applyPickup turns it on; it carries across descent and resets on a new run', () => {
    const s = createGameState();
    applyPickup(s.player, 'dashStrike');
    expect(s.player.dashStrike).toBe(true);

    descendOnce(s);
    expect(s.run.depth).toBe(2);
    expect(s.player.dashStrike).toBe(true); // carried

    startNewRun(s, 4242);
    expect(s.player.dashStrike).toBe(false); // reset
  });
});
