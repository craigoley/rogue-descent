/**
 * Pure helpers for the unified CENTER-SCREEN arrival beat (render/UI layer). Kept in
 * their own module — ZERO three/DOM imports — so the show/fade decisions are unit-
 * testable without standing up the DOM HUD.
 *
 * The arrival beat is a centered stack: the "ROGUE DESCENT" title (floor 1 / game-start
 * only) above the "DEPTH N" announce (every floor). Both show on arrival and fade on
 * LEAVING THE ENTRY ROOM — the player's centre crossing out of the always-room-0 spawn
 * room (playerRoomIndex !== 0), which fires PRE-combat (the "not waiting for enemies"
 * fix) rather than on the combat-room lock (activeRoom >= 0, which was too late).
 *
 * The depth decision is a tiny state machine over three inputs:
 *   - depthChanged:   state.run.depth differs from the last frame (a new floor loaded).
 *   - leftEntryRoom:  the player's centre has left the spawn room (playerRoomIndex !== 0).
 *   - depthFaded:     whether the depth has ALREADY faded on THIS floor (per-floor latch,
 *                     reset to false on each arrival).
 */

/** What the HUD should do with the depth announce this frame. */
export type DepthAction = 'show' | 'fade' | 'none';

/**
 * Per-floor depth show/fade decision (pure).
 *
 *   - ARRIVAL (depthChanged): SHOW — a new floor's entry room. Takes priority; by
 *     construction the player is still in the spawn room here, so it can't collide with
 *     'fade'.
 *   - LEFT THE ENTRY ROOM (!depthFaded && leftEntryRoom): FADE — once per floor.
 *   - otherwise: NONE — steady state (showing in the entry room, or already faded).
 */
export function depthFadeAction(
  depthChanged: boolean,
  leftEntryRoom: boolean,
  depthFaded: boolean,
): DepthAction {
  if (depthChanged) return 'show';
  if (!depthFaded && leftEntryRoom) return 'fade';
  return 'none';
}

/**
 * Title fade decision (pure): the "ROGUE DESCENT" centerpiece is a ONE-TIME game-start
 * flourish — it fades exactly once, when the player first LEAVES the entry room, and
 * never reverts. True only on that first leave (leftEntryRoom && not yet faded).
 */
export function shouldFadeTitle(leftEntryRoom: boolean, titleFaded: boolean): boolean {
  return leftEntryRoom && !titleFaded;
}
