import { describe, expect, it } from 'vitest';
import { resolveX, resolveY } from '../Collision';
import { buildTestRoom } from '../Room';
import { PLAYER } from '../../utils/constants';

const room = buildTestRoom();
const r = PLAYER.radius;
const wallFaceX = (room.tilesX - 1) * room.tileSize; // right wall face, x = 13
const wallFaceY = (room.tilesY - 1) * room.tileSize; // bottom wall face, y = 13

describe('Collision — stop clean against walls', () => {
  it('resolveX stops flush at the right wall instead of penetrating', () => {
    const nx = resolveX(12.5, 7, 1.0, r, room); // try to move well into the wall
    expect(nx).toBeCloseTo(wallFaceX - r, 9); // flush: 13 - 0.4 = 12.6
    expect(nx).toBeLessThan(12.5 + 1.0); // i.e. it was actually blocked
  });

  it('resolveY stops flush at the bottom wall', () => {
    const ny = resolveY(7, 12.5, 1.0, r, room);
    expect(ny).toBeCloseTo(wallFaceY - r, 9);
  });

  it('returns the requested position when nothing is in the way', () => {
    expect(resolveX(7, 7, 0.1, r, room)).toBeCloseTo(7.1, 9);
    expect(resolveY(7, 7, -0.1, r, room)).toBeCloseTo(6.9, 9);
  });
});

describe('Collision — SLIDE along walls (the flush-corner regression)', () => {
  it('a body flush against the right wall can still move freely in Y (slides)', () => {
    const x = wallFaceX - r; // pinned flush against the right wall, x = 12.6
    // Perpendicular (Y) movement must NOT be blocked by the wall the body is
    // flush against — the half-open span fix. Y is open floor here.
    const ny = resolveY(x, 7, 0.1, r, room);
    expect(ny).toBeCloseTo(7.1, 9); // slid the full requested distance
  });

  it('a body flush against the bottom wall can still move freely in X (slides)', () => {
    const y = wallFaceY - r;
    const nx = resolveX(7, y, 0.1, r, room);
    expect(nx).toBeCloseTo(7.1, 9);
  });

  it('pushing diagonally into a corner blocks both axes (no escape)', () => {
    const nx = resolveX(wallFaceX - r, wallFaceY - r, 0.5, r, room);
    const ny = resolveY(wallFaceX - r, wallFaceY - r, 0.5, r, room);
    expect(nx).toBeCloseTo(wallFaceX - r, 9);
    expect(ny).toBeCloseTo(wallFaceY - r, 9);
  });
});
