/**
 * Owns the three.js scene, the isometric OrthographicCamera, and the WebGL
 * renderer. The camera looks at a fixed target down a (offset, offset, offset)
 * diagonal, which is what produces the classic 2:1 isometric read with an
 * orthographic (non-perspective) projection.
 *
 * This layer only ever READS game state. World coordinates map to three.js as
 * (game x -> three x, game y -> three z); three's y is up.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CAMERA, PALETTE } from '../utils/constants';

export class SceneManager {
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  private readonly renderer: WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly target = new Vector3(0, 0, 0);

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new Color(PALETTE.background);

    const { offset, near, far } = CAMERA;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, near, far);
    this.camera.position.set(offset, offset, offset);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    // Flat, slightly directional lighting so wall tops read against the floor.
    this.scene.add(new AmbientLight(0xffffff, 0.85));
    const key = new DirectionalLight(0xffffff, 0.6);
    key.position.set(offset, offset * 1.5, offset * 0.5);
    this.scene.add(key);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** Point the camera at a world position (e.g. the room centre). */
  lookAt(worldX: number, worldZ: number): void {
    this.target.set(worldX, 0, worldZ);
    this.camera.position.set(
      worldX + CAMERA.offset,
      CAMERA.offset,
      worldZ + CAMERA.offset,
    );
    this.camera.lookAt(this.target);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private resize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const aspect = w / h;
    const v = CAMERA.viewSize;
    this.camera.left = -v * aspect;
    this.camera.right = v * aspect;
    this.camera.top = v;
    this.camera.bottom = -v;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
}
