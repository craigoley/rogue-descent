import { describe, expect, it } from 'vitest';
import { createPlayer, updatePlayer, type PlayerState } from '../Player';
import { buildTestRoom } from '../Room';
import { createIntent, type InputIntent } from '../Input';
import { CAMERA, SIM_DT, TUNING } from '../../utils/constants';

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
 * REAL iso camera, derived purely from CAMERA's offset (no three.js). The camera
 * sits at offset (ox, oy, oz) looking at the focus with world-up = +y; this
 * mirrors three's lookAt basis:
 *   Zc = normalize(ox, oy, oz)            (focus -> camera)
 *   Xc = normalize(worldUp × Zc) = normalize(oz, 0, -ox)   (screen-right)
 *   Yc = Zc × Xc                                            (screen-up)
 * A floor velocity is (vx, 0, vy) in three coords; screen-right = v·Xc,
 * screen-up = v·Yc. This is the iso-mapping regression guard: under the restored
 * 45° yaw, "up" input must still project straight up the screen even though it
 * is a world diagonal.
 */
function project(p: PlayerState): { right: number; up: number } {
  const { offsetX: ox, offsetY: oy, offsetZ: oz } = CAMERA;
  const zl = Math.hypot(ox, oy, oz);
  const zc = [ox / zl, oy / zl, oz / zl];
  const xl = Math.hypot(oz, ox);
  const xc = [oz / xl, 0, -ox / xl];
  const yc = [
    zc[1] * xc[2] - zc[2] * xc[1],
    zc[2] * xc[0] - zc[0] * xc[2],
    zc[0] * xc[1] - zc[1] * xc[0],
  ];
  const v = [p.vx, 0, p.vy];
  return {
    right: v[0] * xc[0] + v[1] * xc[1] + v[2] * xc[2],
    up: v[0] * yc[0] + v[1] * yc[1] + v[2] * yc[2],
  };
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

describe('Player iso input mapping — restored 45° diamond (the regression guard)', () => {
  it('"up" (0,-1) projects straight UP the screen under the yawed camera', () => {
    const p = createPlayer(7, 7);
    step(p, { moveY: -1 }, 6);
    const s = project(p);
    expect(s.up).toBeGreaterThan(0); // goes up the screen
    expect(s.right).toBeCloseTo(0, 6); // straight up, no sideways drift
  });

  it('"right" (1,0) projects straight RIGHT on screen under the yawed camera', () => {
    const p = createPlayer(7, 7);
    step(p, { moveX: 1 }, 6);
    const s = project(p);
    expect(s.right).toBeGreaterThan(0);
    expect(s.up).toBeCloseTo(0, 6);
  });

  it('"up" is a world DIAGONAL across the diamond (grid-tracking abandoned)', () => {
    // Restored 45° yaw => input rotation is the real π/4 => intent (0,-1) maps to
    // a world diagonal: BOTH vx and vy are non-zero and equal magnitude. This is
    // the iso behaviour (Hades/Diablo), the inverse of PR #8's grid-locked axis.
    const p = createPlayer(7, 7);
    step(p, { moveY: -1 }, 6);
    expect(p.vx).toBeLessThan(0);
    expect(p.vy).toBeLessThan(0);
    expect(Math.abs(p.vx)).toBeCloseTo(Math.abs(p.vy), 6); // 45° diagonal
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
