import { describe, expect, it } from 'vitest';
import { createPlayer, updatePlayer } from '../Player';
import { createIntent } from '../Input';
import { PLAYER } from '../../utils/constants';

/** Bounds large enough that clamping never interferes with these movement
 *  assertions; clamping gets its own test below. */
const OPEN = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };

describe('Player.updatePlayer', () => {
  it('moves by speed * dt along a single axis', () => {
    const p = createPlayer(0, 0);
    const dt = 1 / 60;
    updatePlayer(p, { ...createIntent(), moveX: 1 }, dt, OPEN);
    expect(p.x).toBeCloseTo(PLAYER.speed * dt, 10);
    expect(p.y).toBe(0);
  });

  it('normalizes diagonal input so it is not faster than cardinal', () => {
    const p = createPlayer(0, 0);
    const dt = 1 / 60;
    updatePlayer(p, { moveX: 1, moveY: 1 }, dt, OPEN);
    // Total displacement equals one axis of cardinal movement, not sqrt(2)x.
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(PLAYER.speed * dt, 10);
  });

  it('stays put with no input', () => {
    const p = createPlayer(5, 5);
    updatePlayer(p, createIntent(), 1 / 60, OPEN);
    expect(p.x).toBe(5);
    expect(p.y).toBe(5);
  });

  it('clamps to the supplied bounds', () => {
    const p = createPlayer(9.9, 0);
    updatePlayer(p, { moveX: 1, moveY: 0 }, 1, { minX: 0, maxX: 10, minY: 0, maxY: 10 });
    expect(p.x).toBe(10);
  });
});
