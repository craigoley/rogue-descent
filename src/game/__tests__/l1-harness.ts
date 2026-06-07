/**
 * L1 headless-sim integration test harness — TEST-ONLY (not imported by src/game/,
 * not a .test file, so Vitest doesn't run it as a suite). Thin helpers over the
 * REAL loop entry points (createGameState / startNewRun(seed) / update(state,
 * intent, dt)) that main.ts drives, so an integration test runs the identical
 * deterministic sim with a fixed seed + scripted input. No pathfinder — high-value
 * scenarios position the player via placeInRoom and script combat (per the recon).
 */
import { update, type GameState } from '../GameState';
import { createIntent, type InputIntent } from '../Input';
import { SIM_DT } from '../../utils/constants';

/** Build an InputIntent from a partial (the rest defaults to no-input). */
export function intent(partial: Partial<InputIntent> = {}): InputIntent {
  return { ...createIntent(), ...partial };
}

/** A no-input frame (idle). Fresh object each call (edge flags are consumed). */
export const idle = (): InputIntent => createIntent();

/**
 * Step the REAL loop for up to `frames` fixed SIM_DT ticks, feeding `script(frame)`
 * as the input each tick. Stops early (and returns the frame count run) once
 * `until(state)` is true — checked BEFORE each step, so 0 frames run if already
 * satisfied. `script` is input-only by contract (it must not mutate state); tests
 * that need per-frame state control use an explicit loop instead.
 */
export function runFrames(
  state: GameState,
  script: (frame: number) => InputIntent,
  frames: number,
  until?: (state: GameState) => boolean,
): number {
  for (let f = 0; f < frames; f++) {
    if (until && until(state)) return f;
    update(state, script(f), SIM_DT);
  }
  return frames;
}

/** Place the player on a guaranteed ROOM-BODY (non-corridor) cell of room `i` —
 *  a genuine entry trigger (a corridor carved THROUGH the rect must not count).
 *  Mirrors the helper already recurring across the boss/descent suites. */
export function placeInRoom(s: GameState, i: number): void {
  const r = s.rooms[i].rect;
  const room = s.room;
  for (let ty = r.y; ty < r.y + r.h; ty++) {
    for (let tx = r.x; tx < r.x + r.w; tx++) {
      if (room.corridor?.[ty * room.tilesX + tx]) continue; // skip corridor strips
      s.player.x = (tx + 0.5) * room.tileSize;
      s.player.y = (ty + 0.5) * room.tileSize;
      return;
    }
  }
  // Fallback (no corridor grid / fully-corridor rect): the rect centre.
  s.player.x = (r.x + r.w / 2) * room.tileSize;
  s.player.y = (r.y + r.h / 2) * room.tileSize;
}

/** True if (x, y) lies within room `i`'s rect (world units). */
export function insideRoomRect(s: GameState, i: number, x: number, y: number): boolean {
  const r = s.rooms[i].rect;
  const ts = s.room.tileSize;
  return x >= r.x * ts && x <= (r.x + r.w) * ts && y >= r.y * ts && y <= (r.y + r.h) * ts;
}
