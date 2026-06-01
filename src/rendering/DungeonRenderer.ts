/**
 * Builds the static room geometry ONCE from RoomState: a floor plane, a faint
 * grid so motion reads, and a box per perimeter wall tile. All geometry is
 * procedural (no art assets). Nothing here allocates per frame — `build` runs
 * at startup and the meshes are then just transformed by the camera.
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
import { PALETTE, ROOM } from '../utils/constants';

export class DungeonRenderer {
  private readonly group = new Group();
  private readonly floorMat = new MeshStandardMaterial({
    color: PALETTE.floor,
    roughness: 1,
  });
  private readonly wallMat = new MeshStandardMaterial({
    color: PALETTE.wall,
    roughness: 0.9,
  });

  constructor(scene: Scene) {
    scene.add(this.group);
  }

  /** Construct floor + walls for the given room. Call once. */
  build(room: RoomState): void {
    this.group.clear();
    const { tileSize } = room;
    const worldW = room.tilesX * tileSize;
    const worldD = room.tilesY * tileSize;

    // Floor plane, rotated flat onto the XZ ground plane, centred under the room.
    const floor = new Mesh(new PlaneGeometry(worldW, worldD), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(worldW / 2, 0, worldD / 2);
    this.group.add(floor);

    // Faint grid for spatial reference.
    const grid = new GridHelper(Math.max(worldW, worldD), Math.max(room.tilesX, room.tilesY), PALETTE.floorLine, PALETTE.floorLine);
    grid.position.set(worldW / 2, 0.01, worldD / 2);
    this.group.add(grid);

    // One box per wall tile. Shared geometry + material keep this cheap.
    const wallGeo = new BoxGeometry(tileSize, ROOM.wallHeight, tileSize);
    for (const w of room.walls) {
      const box = new Mesh(wallGeo, this.wallMat);
      box.position.set(
        (w.tx + 0.5) * tileSize,
        ROOM.wallHeight / 2,
        (w.ty + 0.5) * tileSize,
      );
      this.group.add(box);
    }
  }
}
