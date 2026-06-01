/**
 * Owns the three.js scene, the isometric OrthographicCamera, and the WebGL
 * renderer. The camera looks at its focus down a (offset, offset, offset)
 * diagonal, which is what produces the classic isometric read with an
 * orthographic (non-perspective) projection — the Phase 0 angle, preserved.
 *
 * The focus smoothly FOLLOWS the player: each frame it eases toward the
 * player's interpolated position at TUNING.camLerp (a subtle follow — not
 * locked rigid, not floaty). This layer only READS game state; world
 * coordinates map to three.js as (game x -> three x, game y -> three z).
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
import type { GameState } from '../game/GameState';
import { CAMERA, PALETTE, TUNING } from '../utils/constants';
import { lerp } from '../utils/math';

export class SceneManager {
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  private readonly renderer: WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly target = new Vector3(0, 0, 0);
  /** Camera focus point on the floor plane (game x, game y). */
  private focusX = 0;
  private focusY = 0;

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

  /** Jump the focus to a world position with no easing (use at init so the
   *  first frame isn't a slide-in from the origin). */
  snapFocus(worldX: number, worldY: number): void {
    this.focusX = worldX;
    this.focusY = worldY;
    this.place();
  }

  /** Ease the focus toward the player's interpolated position. `dt` is the real
   *  frame delta (camera smoothing is a render-side effect, not a sim step). */
  updateFollow(state: GameState, alpha: number, dt: number): void {
    const p = state.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);
    const k = 1 - Math.exp(-TUNING.camLerp * dt);
    this.focusX = lerp(this.focusX, px, k);
    this.focusY = lerp(this.focusY, py, k);
    this.place();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // --- Diagnostics ----------------------------------------------------------
  // Project through the REAL camera (no re-derived basis). Reused scratch so the
  // hot loop allocates nothing; the returned object is overwritten each call, so
  // read it immediately. Returns the NDC screen delta of a world vector
  // (ax, ay, az) based at world (ox, oy, oz): x = screen-right, y = screen-UP
  // (NDC y is up-positive). DIAGNOSTIC ONLY — nothing in the sim reads this.
  private readonly _projA = new Vector3();
  private readonly _projB = new Vector3();
  private readonly _screenDelta = { x: 0, y: 0 };
  screenDelta(
    ox: number,
    oy: number,
    oz: number,
    ax: number,
    ay: number,
    az: number,
  ): { x: number; y: number } {
    this._projA.set(ox, oy, oz).project(this.camera);
    this._projB.set(ox + ax, oy + ay, oz + az).project(this.camera);
    this._screenDelta.x = this._projB.x - this._projA.x;
    this._screenDelta.y = this._projB.y - this._projA.y;
    return this._screenDelta;
  }

  /** Reposition the camera so it views the current focus from the iso diagonal. */
  private place(): void {
    const { offset } = CAMERA;
    this.target.set(this.focusX, 0, this.focusY);
    this.camera.position.set(this.focusX + offset, offset, this.focusY + offset);
    this.camera.lookAt(this.target);
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
