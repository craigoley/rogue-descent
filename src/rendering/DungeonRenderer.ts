/**
 * Builds the floor geometry from a RoomState: a floor plane, a faint grid, and
 * one box per BORDER wall tile. Wall boxes are POOLED to DUNGEON.wallRenderMax
 * and only repositioned/shown on `build()` (called at startup and on debug
 * regenerate) — never per frame; walls are static, so their matrices are updated
 * once on placement (matrixAutoUpdate off). A floor whose border-wall count
 * exceeds the pool is rendered truncated and logged.
 *
 * READ-ONLY with respect to game state.
 */

import {
  BoxGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import type { RoomState } from '../game/Room';
import { DUNGEON, PALETTE, ROOM } from '../utils/constants';

export class DungeonRenderer {
  private readonly group = new Group();
  private readonly floorMat = new MeshStandardMaterial({ color: PALETTE.floor, roughness: 1 });
  private readonly wallMat = new MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 });
  private readonly wallGeo = new BoxGeometry(ROOM.tileSize, ROOM.wallHeight, ROOM.tileSize);
  private readonly walls: Mesh[] = [];
  private floor: Mesh | null = null;
  private grid: GridHelper | null = null;

  constructor(scene: Scene) {
    scene.add(this.group);
    // Pre-build the bounded wall pool once. Walls are static after placement, so
    // disable per-frame matrix updates (set once in build()).
    for (let i = 0; i < DUNGEON.wallRenderMax; i++) {
      const m = new Mesh(this.wallGeo, this.wallMat);
      m.visible = false;
      m.matrixAutoUpdate = false;
      this.walls.push(m);
      this.group.add(m);
    }
  }

  /** (Re)build floor + walls for the given room. Cheap enough to call on a debug
   *  regenerate; reuses the wall pool. */
  build(room: RoomState): void {
    const { tileSize } = room;
    const worldW = room.tilesX * tileSize;
    const worldD = room.tilesY * tileSize;

    // Floor plane + grid are 2 objects — recreate (and dispose old) on rebuild.
    if (this.floor) {
      this.group.remove(this.floor);
      this.floor.geometry.dispose();
    }
    this.floor = new Mesh(new PlaneGeometry(worldW, worldD), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(worldW / 2, 0, worldD / 2);
    this.floor.matrixAutoUpdate = false;
    this.floor.updateMatrix();
    this.group.add(this.floor);

    if (this.grid) {
      this.group.remove(this.grid);
      this.grid.geometry.dispose();
    }
    this.grid = new GridHelper(
      Math.max(worldW, worldD),
      Math.max(room.tilesX, room.tilesY),
      PALETTE.floorLine,
      PALETTE.floorLine,
    );
    this.grid.position.set(worldW / 2, 0.01, worldD / 2);
    this.grid.matrixAutoUpdate = false;
    this.grid.updateMatrix();
    this.group.add(this.grid);

    // Place pooled wall boxes for the border tiles; hide the unused remainder.
    const n = Math.min(room.walls.length, this.walls.length);
    if (room.walls.length > this.walls.length) {
      console.warn(
        `[dungeon] ${room.walls.length} border walls exceed render pool ` +
          `(${this.walls.length}); rendering truncated. Raise DUNGEON.wallRenderMax.`,
      );
    }
    for (let i = 0; i < this.walls.length; i++) {
      const m = this.walls[i];
      if (i < n) {
        const w = room.walls[i];
        m.position.set((w.tx + 0.5) * tileSize, ROOM.wallHeight / 2, (w.ty + 0.5) * tileSize);
        m.updateMatrix();
        m.visible = true;
      } else {
        m.visible = false;
      }
    }
  }
}
