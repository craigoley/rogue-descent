/**
 * Renders dynamic entities. For the placeholder that is just the player: one
 * reused cube whose position is SYNCED from PlayerState every frame. The mesh
 * is created once (no per-frame allocation) and the game state is only ever
 * read — `sync` writes into three objects, never into the GameState.
 */

import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  type Scene,
} from 'three';
import type { GameState } from '../game/GameState';
import { PALETTE, PLAYER } from '../utils/constants';

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

  /** Mirror the player's world position onto the cube. Read-only on `state`.
   *  Game (x, y) maps to three (x, z); the cube sits half its height above the
   *  floor. */
  sync(state: GameState): void {
    this.player.position.set(state.player.x, PLAYER.radius, state.player.y);
  }
}
