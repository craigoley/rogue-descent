import { describe, expect, it } from 'vitest';
import { createPlayer, updatePlayer, type PlayerState } from '../Player';
import { buildTestRoom } from '../Room';
import { createIntent, type InputIntent } from '../Input';
import { SIM_DT, TUNING } from '../../utils/constants';

const room = buildTestRoom();
const DT = SIM_DT;

/** Step the player N times holding a fixed intent. */
function step(p: PlayerState, intent: Partial<InputIntent>, n: number): void {
  const full: InputIntent = { ...createIntent(), ...intent };
  for (let i = 0; i < n; i++) updatePlayer(p, full, DT, room);
}

const speed = (p: PlayerState): number => Math.hypot(p.vx, p.vy);

/**
 * Screen projection of a floor velocity (game x = vx, game y = vy) under the
 * SCREEN-ALIGNED camera (zero yaw). World x -> screen-right; world z (= game y)
 * -> screen-vertical, with +z toward the viewer (down). So screen-right ∝ vx and
 * screen-up ∝ -vy. Used to assert input maps to the intended SCREEN direction
 * AND, since the grid lines now run along world x/z, that motion runs along a
 * grid axis (the iso-mapping regression guard for Option 2).
 */
function project(p: PlayerState): { right: number; up: number } {
  return { right: p.vx, up: -p.vy };
}

describe('Player movement — snappy velocity ramp', () => {
  it('accelerates toward maxSpeed over a couple of steps, not instantly', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 1);
    expect(speed(p)).toBeGreaterThan(0);
    expect(speed(p)).toBeLessThan(TUNING.maxSpeed);
    step(p, { moveX: 1 }, 5);
    expect(speed(p)).toBeCloseTo(TUNING.maxSpeed, 5);
  });

  it('ramps without overshoot — non-decreasing speed, capped at maxSpeed', () => {
    const p = createPlayer(7, 7);
    let last = 0;
    let strictlyRoseAtLeastOnce = false;
    for (let i = 0; i < 6; i++) {
      updatePlayer(p, { ...createIntent(), moveX: 1 }, DT, room);
      expect(speed(p)).toBeGreaterThanOrEqual(last - 1e-9);
      expect(speed(p)).toBeLessThanOrEqual(TUNING.maxSpeed + 1e-9);
      if (speed(p) > last) strictlyRoseAtLeastOnce = true;
      last = speed(p);
    }
    expect(strictlyRoseAtLeastOnce).toBe(true); // a real ramp, not an instant jump
  });

  it('friction decays speed to rest within a few steps after release', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 10);
    expect(speed(p)).toBeGreaterThan(0);
    step(p, {}, 5);
    expect(speed(p)).toBeCloseTo(0, 5);
  });

  it('does not stop instantly — still moving one step after release', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 10);
    const before = speed(p);
    step(p, {}, 1);
    expect(speed(p)).toBeLessThan(before);
    expect(speed(p)).toBeGreaterThan(0); // a quick stop, not a teleport to zero
  });

  it('normalizes input — top speed is maxSpeed, not maxSpeed*sqrt2 on diagonals', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1, moveY: 1 }, 8);
    expect(speed(p)).toBeCloseTo(TUNING.maxSpeed, 5);
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

describe('Player iso input mapping — screen-aligned (the regression guard)', () => {
  it('"up" (0,-1) moves UP the screen AND along a grid axis (no drift)', () => {
    const p = createPlayer(7, 7);
    step(p, { moveY: -1 }, 6);
    const s = project(p);
    expect(s.up).toBeGreaterThan(0); // goes up the screen
    expect(s.right).toBeCloseTo(0, 6); // straight up, not drifting sideways
    // Motion runs along the world-z grid line (grid lines = world x/z): the
    // perpendicular component is ~0, so the cube tracks a visible grid line.
    expect(p.vx).toBeCloseTo(0, 6);
    expect(p.vy).toBeLessThan(0);
  });

  it('"right" (1,0) moves RIGHT on screen AND along a grid axis (no drift)', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 6);
    const s = project(p);
    expect(s.right).toBeGreaterThan(0);
    expect(s.up).toBeCloseTo(0, 6);
    expect(p.vy).toBeCloseTo(0, 6); // along the world-x grid line
    expect(p.vx).toBeGreaterThan(0);
  });

  it('with the screen-aligned camera "up" IS a pure world axis (tracks the grid)', () => {
    // Zero camera yaw => input rotation is identity => intent (0,-1) maps to
    // world -z exactly: vx === 0. (This is the inverse of the old diamond
    // behaviour, where "up" was a world diagonal.)
    const p = createPlayer(7, 7);
    step(p, { moveY: -1 }, 6);
    expect(p.vx).toBeCloseTo(0, 6);
    expect(Math.abs(p.vy)).toBeGreaterThan(0.1);
  });
});

describe('Player interpolation snapshot', () => {
  it('records the pre-step position in prevX/prevY each step', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 3);
    const beforeX = p.x;
    const beforeY = p.y;
    updatePlayer(p, { ...createIntent(), moveX: 1 }, DT, room);
    expect(p.prevX).toBe(beforeX);
    expect(p.prevY).toBe(beforeY);
    expect(p.x).not.toBe(beforeX); // current advanced past prev
  });
});

describe('Player wall collision (integration)', () => {
  it('drives into a wall and stops without penetrating it', () => {
    // With the screen-aligned camera the input rotation is identity, so intent
    // (1,0) is pure world +X — straight at the right wall. The body must come to
    // rest flush and never pass through.
    const p = createPlayer(11, 7);
    step(p, { moveX: 1 }, 90);
    const wallFaceX = (room.tilesX - 1) * room.tileSize; // 13
    expect(p.x).toBeLessThanOrEqual(wallFaceX + 1e-9);
    expect(p.x).toBeGreaterThan(11); // it did move toward the wall
  });
});
