import { describe, expect, it } from 'vitest';
import { createGameState, update, startNewRun, type GameState } from '../GameState';
import { createPlayer, updatePlayer, dashMaxCharges, type PlayerState } from '../Player';
import { createIntent } from '../Input';
import { applyPickup, activePickupCount, spawnPickup } from '../Pickup';
import { buildTestRoom } from '../Room';
import { DASH, POOL, SIM_DT, TUNING } from '../../utils/constants';

const DT = SIM_DT;
const room = buildTestRoom();
const idle = createIntent;
const dash = (): ReturnType<typeof createIntent> => ({ ...createIntent(), dash: true });

/** Step until dash is back to full; return the step count (or a cap). */
function stepsToFull(p: PlayerState): number {
  let n = 0;
  while (p.dashCharges < dashMaxCharges(p) && n < 2000) {
    updatePlayer(p, createIntent(), DT, room);
    n++;
  }
  return n;
}

/** Finish the current dash burst so another dash is allowed. */
function finishBurst(p: PlayerState): void {
  while (p.dashTimer > 0) updatePlayer(p, createIntent(), DT, room);
}

/** Clear the floor and step onto the stairs to descend once. */
function descendOnce(s: GameState): void {
  for (let i = 0; i < s.rooms.length; i++) s.rooms[i].phase = i === 1 ? 'active' : 'cleared';
  s.activeRoom = 1;
  s.bossDefeated = true; // Phase 8: descent gates on the boss being dead
  s.player.x = s.spawn.x;
  s.player.y = s.spawn.y;
  update(s, idle(), DT); // resolve room 1 -> stairs placed + active
  s.player.x = s.stairs.x;
  s.player.y = s.stairs.y;
  update(s, idle(), DT); // descend
}

describe('Dash economy — starts full, scarce recharge', () => {
  it('a fresh player starts with a full single charge', () => {
    const p = createPlayer(7, 7);
    expect(dashMaxCharges(p)).toBe(DASH.baseCharges);
    expect(p.dashCharges).toBe(DASH.baseCharges);
  });

  it('a dash spends the charge; with none left a second dash does nothing', () => {
    const p = createPlayer(7, 7);
    updatePlayer(p, dash(), DT, room);
    expect(p.dashCharges).toBe(0);
    expect(p.dashTimer).toBeGreaterThan(0);
    finishBurst(p);
    const x = p.x;
    updatePlayer(p, dash(), DT, room); // no charge -> no-op
    expect(p.dashTimer).toBe(0);
    expect(Math.abs(p.x - x)).toBeLessThan(0.5);
  });

  it('one charge refills in ~dashRecharge seconds (the slowed rate)', () => {
    const p = createPlayer(7, 7);
    updatePlayer(p, dash(), DT, room); // -> 0 charges, recharge begins
    const n = stepsToFull(p);
    expect(p.dashCharges).toBe(1);
    expect(n * DT).toBeCloseTo(TUNING.dashRecharge, 1); // ~1.6s, not the old 0.5
  });
});

describe('Dash economy — EXTRA-CHARGE powerup', () => {
  it('raises the cap to 2 and grants the charge immediately on pickup', () => {
    const p = createPlayer(7, 7);
    applyPickup(p, 'extraCharge');
    expect(p.extraCharge).toBe(true);
    expect(dashMaxCharges(p)).toBe(2);
    expect(p.dashCharges).toBe(2); // felt on pickup, not after a recharge
  });

  it('allows TWO dashes before empty (vs one at baseline)', () => {
    const p = createPlayer(7, 7);
    applyPickup(p, 'extraCharge');

    updatePlayer(p, dash(), DT, room); // dash 1
    expect(p.dashCharges).toBe(1);
    finishBurst(p); // ~0.16s — far less than a recharge, so still 1 charge
    updatePlayer(p, dash(), DT, room); // dash 2
    expect(p.dashCharges).toBe(0);
    finishBurst(p);
    const x = p.x;
    updatePlayer(p, dash(), DT, room); // dash 3 blocked
    expect(p.dashTimer).toBe(0);
    expect(Math.abs(p.x - x)).toBeLessThan(0.5);
  });
});

describe('Dash economy — FASTER-RECHARGE powerup', () => {
  it('refills a charge in fewer steps than baseline', () => {
    const base = createPlayer(7, 7);
    updatePlayer(base, dash(), DT, room);
    const baseSteps = stepsToFull(base);

    const fast = createPlayer(7, 7);
    applyPickup(fast, 'fasterRecharge');
    expect(fast.fasterRecharge).toBe(true);
    updatePlayer(fast, dash(), DT, room);
    const fastSteps = stepsToFull(fast);

    expect(fastSteps).toBeLessThan(baseSteps);
    expect(fastSteps * DT).toBeCloseTo(TUNING.dashRecharge * TUNING.dashFasterRechargeFactor, 1);
  });
});

describe('Dash economy — persistence + reset (mirrors pierce/knockback)', () => {
  it('both dash powerups CARRY across descent (and arrive with dash full)', () => {
    const s = createGameState();
    applyPickup(s.player, 'extraCharge');
    applyPickup(s.player, 'fasterRecharge');
    descendOnce(s);
    expect(s.run.depth).toBe(2); // confirm we descended
    expect(s.player.extraCharge).toBe(true);
    expect(s.player.fasterRecharge).toBe(true);
    expect(s.player.dashCharges).toBe(dashMaxCharges(s.player)); // full (2) on arrival
  });

  it('a NEW run resets both toggles + the dash cap', () => {
    const s = createGameState();
    applyPickup(s.player, 'extraCharge');
    applyPickup(s.player, 'fasterRecharge');
    startNewRun(s, 4242);
    expect(s.player.extraCharge).toBe(false);
    expect(s.player.fasterRecharge).toBe(false);
    expect(dashMaxCharges(s.player)).toBe(DASH.baseCharges);
    expect(s.player.dashCharges).toBe(DASH.baseCharges);
  });
});

describe('Dash economy — pickup pool is not exceeded by the new kinds', () => {
  it('spawning many dash powerups never grows past POOL.pickups', () => {
    const s = createGameState();
    for (let i = 0; i < 50; i++) {
      spawnPickup(s.pickups, 5, 5, i % 2 === 0 ? 'extraCharge' : 'fasterRecharge', -1);
    }
    expect(s.pickups.length).toBe(POOL.pickups);
    expect(activePickupCount(s.pickups)).toBeLessThanOrEqual(POOL.pickups);
  });
});
