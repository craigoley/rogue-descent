import { describe, expect, it } from 'vitest';
import { deadZoneFollow, type Vec2 } from '../../utils/math';

const out: Vec2 = { x: 0, y: 0 };

describe('Camera dead-zone follow', () => {
  it('holds the focus still while the player is inside the dead zone', () => {
    deadZoneFollow(0, 0, 1, 0, 2, 1, out); // player 1 unit away, dead zone 2
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('holds at exactly the dead-zone radius (boundary is inclusive)', () => {
    deadZoneFollow(0, 0, 2, 0, 2, 1, out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('with k=1 snaps the focus so the player sits on the dead-zone edge', () => {
    deadZoneFollow(0, 0, 5, 0, 2, 1, out); // player 5 away, dz 2 -> focus to 3
    expect(out.x).toBeCloseTo(3, 9);
    expect(out.y).toBeCloseTo(0, 9);
    // The player is now exactly `deadZone` from the focus.
    expect(Math.hypot(5 - out.x, 0 - out.y)).toBeCloseTo(2, 9);
  });

  it('eases only partway with k<1 (smooth follow)', () => {
    deadZoneFollow(0, 0, 5, 0, 2, 0.5, out); // target focus 3, from 0 at k=0.5 -> 1.5
    expect(out.x).toBeCloseTo(1.5, 9);
  });

  it('follows along the true direction to the player (diagonal)', () => {
    // dist = 10, dz = 5 -> focus = player - dir*5 = (6,8) - (0.6,0.8)*5 = (3,4)
    deadZoneFollow(0, 0, 6, 8, 5, 1, out);
    expect(out.x).toBeCloseTo(3, 9);
    expect(out.y).toBeCloseTo(4, 9);
  });

  it('deadZone 0 reduces to a plain follow (locks to the player at k=1)', () => {
    deadZoneFollow(0, 0, 5, 3, 0, 1, out);
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(3, 9);
  });
});
