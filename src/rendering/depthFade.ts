/**
 * Pure helper for the PER-FLOOR depth-indicator show/fade (render/UI layer).
 * Kept in its own module — ZERO three/DOM imports — so the re-arm logic is
 * unit-testable without standing up the DOM HUD.
 *
 * The "DEPTH N" readout is a per-floor flourish: it RE-SHOWS on each new floor's
 * entry room (pre-combat) and FADES when the player enters that floor's first
 * combat room — then re-arms on the next descent. (The title wordmark, by
 * contrast, is a one-time game-open flourish that never re-shows — decoupled.)
 *
 * The decision is a tiny state machine over three inputs:
 *   - depthChanged: state.run.depth differs from the last frame (a new floor was
 *     loaded; activeRoom === -1 by construction at that moment).
 *   - activeRoom:   state.activeRoom (>= 0 once the player is in an encounter room).
 *   - depthFaded:   whether the depth has ALREADY faded on THIS floor (the
 *     per-floor latch, reset to false on each arrival).
 */

/** What the HUD should do with the depth element this frame. */
export type DepthAction = 'show' | 'fade' | 'none';

/**
 * Per-floor depth show/fade decision (pure).
 *
 *   - ARRIVAL (depthChanged): re-SHOW — a new floor's entry room. Takes priority;
 *     by construction activeRoom === -1 here, so it can't collide with 'fade'.
 *   - FIRST COMBAT ROOM (!depthFaded && activeRoom >= 0): FADE — once per floor.
 *   - otherwise: NONE — steady state (showing pre-combat, or already faded).
 */
export function depthFadeAction(
  depthChanged: boolean,
  activeRoom: number,
  depthFaded: boolean,
): DepthAction {
  if (depthChanged) return 'show';
  if (!depthFaded && activeRoom >= 0) return 'fade';
  return 'none';
}
