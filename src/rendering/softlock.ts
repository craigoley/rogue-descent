/**
 * Pure helper for the softlock auto-detector (render/debug layer). Kept in its
 * own module — ZERO three/DOM imports — so the detector's decision is unit-
 * testable without standing up the DOM HUD.
 *
 * The detector flags a room that is `active` with live enemies but makes no
 * progress. A KITING/avoidant fight (a live enemy IN the room, just distant
 * because the player isn't approaching) is RESOLVABLE — the player can walk over
 * and kill it — so it must NOT be flagged. In a convex (rectangular) room,
 * "nearest live enemy is inside the room rect" == "reachable" == resolvable.
 * The detector therefore only accumulates a stall when the nearest live enemy is
 * OUT of the rect (genuinely unreachable / escaped) — the true-softlock tripwire.
 */

/** Minimal enemy shape this helper needs (structural — any Enemy satisfies it). */
export interface PointEnemy {
  active: boolean;
  x: number;
  y: number;
}

/** Minimal tile rect shape (any Rect satisfies it). */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** True when the tile at world (x, y) lies inside `rect` (tile coords). */
function inRoom(x: number, y: number, rect: TileRect, tileSize: number): boolean {
  const tx = Math.floor(x / tileSize);
  const ty = Math.floor(y / tileSize);
  return tx >= rect.x && tx < rect.x + rect.w && ty >= rect.y && ty < rect.y + rect.h;
}

/**
 * Is the NEAREST live enemy to (px, py) inside `rect`? In a convex room that
 * means the player can path to it, so the fight is resolvable (the detector
 * should reset, not fire). Returns `false` when there are no live enemies (the
 * caller handles the no-enemies case separately) — i.e. "not resolvable-by-
 * walking-over", so this never on its own suppresses a genuine stuck state.
 */
export function nearestLiveEnemyInRoom(
  enemies: readonly PointEnemy[],
  px: number,
  py: number,
  rect: TileRect,
  tileSize: number,
): boolean {
  let nearest = Infinity;
  let nearestInRoom = false;
  for (const e of enemies) {
    if (!e.active) continue;
    const dx = e.x - px;
    const dy = e.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearest) {
      nearest = d2;
      nearestInRoom = inRoom(e.x, e.y, rect, tileSize);
    }
  }
  return nearestInRoom;
}
