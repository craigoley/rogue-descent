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

/**
 * Which surface the per-floor depth cue uses:
 *   - 'hud'      — FLOOR 1 (depth === 1): the HUD-band `.hud-depth`, shown at spawn in
 *                  the UNcompacted layout where it sits clear (title above, bars below).
 *   - 'announce' — FLOOR 2+ (depth > 1): a CENTER-SCREEN arrival announce on the clean
 *                  entry-room playfield. On later floors the HUD is already #100-compacted
 *                  (chips risen into the HUD band), so re-showing the HUD-band depth there
 *                  COLLIDES with the chip grid — the center announce replaces it.
 */
export type DepthTarget = 'hud' | 'announce';

/** Route the depth cue to its surface by floor (pure). */
export function depthTarget(depth: number): DepthTarget {
  return depth > 1 ? 'announce' : 'hud';
}

/** The full per-floor depth cue: the show/fade action AND which surface it drives. The
 *  caller applies `action` to whichever element `target` names (and keeps the OTHER
 *  surface hidden, so there's never a double-shown / colliding depth). Pure. */
export interface DepthCue {
  action: DepthAction;
  target: DepthTarget;
}
export function depthCue(
  depthChanged: boolean,
  depth: number,
  activeRoom: number,
  depthFaded: boolean,
): DepthCue {
  return {
    action: depthFadeAction(depthChanged, activeRoom, depthFaded),
    target: depthTarget(depth),
  };
}
