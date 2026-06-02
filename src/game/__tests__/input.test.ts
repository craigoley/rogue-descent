import { describe, expect, it } from 'vitest';
import { createIntent, dragAxes, keyAxes } from '../Input';
import { createPlayer, updatePlayer, type PlayerState } from '../Player';
import { buildTestRoom } from '../Room';
import { SIM_DT, TOUCH } from '../../utils/constants';

const room = buildTestRoom();

describe('Input mappings — keyboard/touch parity (raw, pre-rotation)', () => {
  it('"up" is the same intent from a key and an upward drag', () => {
    expect(keyAxes(new Set(['w']))).toEqual({ moveX: 0, moveY: -1 });
    expect(dragAxes(0, -TOUCH.range, TOUCH.range)).toEqual({ moveX: 0, moveY: -1 });
  });

  it('"right" matches between a key and a rightward drag', () => {
    expect(keyAxes(new Set(['d']))).toEqual({ moveX: 1, moveY: 0 });
    expect(dragAxes(TOUCH.range, 0, TOUCH.range)).toEqual({ moveX: 1, moveY: 0 });
  });

  it('"up-right" diagonal matches between keys and a diagonal drag', () => {
    expect(keyAxes(new Set(['w', 'd']))).toEqual({ moveX: 1, moveY: -1 });
    expect(dragAxes(TOUCH.range, -TOUCH.range, TOUCH.range)).toEqual({ moveX: 1, moveY: -1 });
  });

  it('arrow keys and WASD are equivalent', () => {
    expect(keyAxes(new Set(['arrowup']))).toEqual(keyAxes(new Set(['w'])));
    expect(keyAxes(new Set(['arrowleft']))).toEqual(keyAxes(new Set(['a'])));
  });

  it('a drag beyond range clamps to full deflection', () => {
    expect(dragAxes(TOUCH.range * 5, 0, TOUCH.range)).toEqual({ moveX: 1, moveY: 0 });
  });
});

describe('Input mappings — identical movement post-rotation', () => {
  const drive = (axes: { moveX: number; moveY: number }): PlayerState => {
    const p = createPlayer(7, 7);
    const intent = { ...createIntent(), moveX: axes.moveX, moveY: axes.moveY };
    for (let i = 0; i < 6; i++) updatePlayer(p, intent, SIM_DT, room);
    return p;
  };

  it('keyboard "up" and touch "up" produce the same world velocity', () => {
    const byKey = drive(keyAxes(new Set(['w'])));
    const byTouch = drive(dragAxes(0, -TOUCH.range, TOUCH.range));
    expect(byTouch.vx).toBeCloseTo(byKey.vx, 9);
    expect(byTouch.vy).toBeCloseTo(byKey.vy, 9);
  });
});
