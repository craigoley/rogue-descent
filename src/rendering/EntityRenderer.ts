/**
 * Renders dynamic entities. For Phase 1 that is just the player: one reused
 * cube. Its position is INTERPOLATED between the player's previous and current
 * sim-step positions by the frame's `alpha`, so motion is smooth at any refresh
 * rate (60/120 Hz) regardless of how many sim steps ran this frame. The mesh is
 * created once (no per-frame allocation) and the game state is only ever read —
 * `sync` writes into three objects, never into the GameState. This interpolation
 * pattern is inherited by every entity added in later phases.
 */

import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  type Scene,
} from 'three';
import type { GameState } from '../game/GameState';
import { PALETTE, PLAYER } from '../utils/constants';
import { lerp } from '../utils/math';

export class EntityRenderer {
  private readonly player: Mesh;

  constructor(scene: Scene) {
    const size = PLAYER.radius * 2;
    this.player = new Mesh(
      new BoxGeometry(size, size, size),
      new MeshStandardMaterial({
        color: PALETTE.player,
        emissive: PALETTE.player,
        emissiveIntensity: 0.4,
        roughness: 0.5,
      }),
    );
    scene.add(this.player);
  }

  /**
   * Place the cube at the player's interpolated position. `alpha` is the frame's
   * fraction through the current sim step (remainder / SIM_DT). Read-only on
   * `state`. Game (x, y) maps to three (x, z); the cube sits half its height
   * above the floor.
   */
  sync(state: GameState, alpha: number): void {
    const p = state.player;
    const x = lerp(p.prevX, p.x, alpha);
    const y = lerp(p.prevY, p.y, alpha);
    this.player.position.set(x, PLAYER.radius, y);
  }
}
