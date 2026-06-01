import { describe, expect, it } from 'vitest';
import { createPlayer, updatePlayer, type PlayerState } from '../Player';
import { buildTestRoom } from '../Room';
import { createIntent, type InputIntent } from '../Input';
import { PLAYER, SIM_DT, TUNING } from '../../utils/constants';

const room = buildTestRoom();
const DT = SIM_DT;

/** Step the player N times holding a fixed intent. */
function step(p: PlayerState, intent: Partial<InputIntent>, n: number): void {
  const full: InputIntent = { ...createIntent(), ...intent };
  for (let i = 0; i < n; i++) updatePlayer(p, full, DT, room);
}

describe('Player movement — snappy velocity ramp', () => {
  it('accelerates toward maxSpeed over a couple of steps, not instantly', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 1);
    // After one step the velocity has begun ramping but is well below top speed.
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(TUNING.maxSpeed);
    // ...and after several steps it has essentially reached maxSpeed.
    step(p, { moveX: 1 }, 5);
    expect(p.vx).toBeCloseTo(TUNING.maxSpeed, 5);
  });

  it('ramps without overshoot — non-decreasing, capped at maxSpeed', () => {
    const p = createPlayer(7, 7);
    let last = 0;
    let strictlyRoseAtLeastOnce = false;
    for (let i = 0; i < 6; i++) {
      updatePlayer(p, { ...createIntent(), moveX: 1 }, DT, room);
      expect(p.vx).toBeGreaterThanOrEqual(last); // never oscillates/overshoots back
      expect(p.vx).toBeLessThanOrEqual(TUNING.maxSpeed + 1e-9); // never exceeds cap
      if (p.vx > last) strictlyRoseAtLeastOnce = true;
      last = p.vx;
    }
    expect(strictlyRoseAtLeastOnce).toBe(true); // a real ramp, not an instant jump
  });

  it('friction decays velocity to rest within a few steps after release', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 10); // up to speed
    expect(p.vx).toBeGreaterThan(0);
    step(p, {}, 5); // release
    expect(p.vx).toBeCloseTo(0, 5);
  });

  it('does not stop instantly — still moving one step after release', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 10);
    const vBefore = p.vx;
    step(p, {}, 1);
    expect(p.vx).toBeLessThan(vBefore);
    expect(p.vx).toBeGreaterThan(0); // a quick stop, not a teleport to zero
  });

  it('normalizes diagonals — top speed is maxSpeed, not maxSpeed*sqrt2', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1, moveY: 1 }, 8);
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(TUNING.maxSpeed, 5);
  });

  it('stays put with no input', () => {
    const p = createPlayer(7, 7);
    step(p, {}, 3);
    expect(p.x).toBe(7);
    expect(p.y).toBe(7);
    expect(p.vx).toBe(0);
    expect(p.vy).toBe(0);
  });
});

describe('Player interpolation snapshot', () => {
  it('records the pre-step position in prevX/prevY each step', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 3); // get it moving
    const beforeX = p.x;
    const beforeY = p.y;
    updatePlayer(p, { ...createIntent(), moveX: 1 }, DT, room);
    expect(p.prevX).toBe(beforeX);
    expect(p.prevY).toBe(beforeY);
    expect(p.x).not.toBe(beforeX); // current advanced past prev
  });
});

describe('Player wall collision', () => {
  // Right wall: tile column 13 spans world x in [13, 14]; its face is at x = 13,
  // so a radius-r box stops flush at x = 13 - r.
  const wallFaceX = (room.tilesX - 1) * room.tileSize; // 13
  const restX = wallFaceX - PLAYER.radius; // 12.6

  it('stops clean against a wall and zeroes the into-wall velocity', () => {
    const p = createPlayer(12, 7); // open floor, just left of the right wall
    step(p, { moveX: 1 }, 60); // drive into it for a second
    expect(p.x).toBeCloseTo(restX, 6);
    expect(p.x).toBeLessThanOrEqual(restX + 1e-9); // never penetrates
    expect(p.vx).toBe(0);
  });

  it('SLIDES along a wall instead of sticking (diagonal into the wall)', () => {
    const p = createPlayer(12, 7);
    step(p, { moveX: 1 }, 30); // press flush against the right wall first
    expect(p.x).toBeCloseTo(restX, 6);
    const yStart = p.y;
    // Now hold into-the-wall (+x) AND along-the-wall (+y) together.
    step(p, { moveX: 1, moveY: 1 }, 20);
    expect(p.x).toBeCloseTo(restX, 6); // still pinned to the wall on x
    expect(p.y).toBeGreaterThan(yStart + 0.5); // but slid a clear distance on y
    expect(p.vy).toBeGreaterThan(0); // and is still moving along it
  });
});
