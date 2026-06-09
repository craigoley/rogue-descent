/**
 * Owns the three.js scene, the OrthographicCamera, and the WebGL renderer. The
 * camera views its focus from a classic ISOMETRIC offset (equal offsetX/offsetZ
 * for a 45° yaw, +offsetY for the downward pitch) — so it looks down the body
 * diagonal: the floor renders as a 45° DIAMOND and cubes show three faces (top +
 * two sides, a hexagonal silhouette), i.e. true 3D height, not flat top-down.
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
  LinearToneMapping,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { GameState } from '../game/GameState';
import { CAMERA, KEY_LIGHT_POS, LIGHTING, PALETTE, RIM_LIGHT_POS, TUNING } from '../utils/constants';
import { deadZoneFollow, lerp, type Vec2 } from '../utils/math';

export class SceneManager {
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;
  private readonly renderer: WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly target = new Vector3(0, 0, 0);
  /** Camera focus point on the floor plane (game x, game y). */
  private focusX = 0;
  private focusY = 0;
  /** Reused scratch for the dead-zone follow result (no per-frame allocation). */
  private readonly _focusOut: Vec2 = { x: 0, y: 0 };

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new Color(PALETTE.background);

    const { offsetX, offsetY, offsetZ, near, far } = CAMERA;
    this.camera = new OrthographicCamera(-1, 1, 1, -1, near, far);
    this.camera.position.set(offsetX, offsetY, offsetZ);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Exposure via LinearToneMapping (a flat ×exposure, NOT ACES — ACES would
    // desaturate the neon palette). At exposure 1.0 this matches no tone mapping;
    // LIGHTING.exposure gives a gentle phone-tunable lift. Curves wait for bloom.
    this.renderer.toneMapping = LinearToneMapping;
    this.renderer.toneMappingExposure = LIGHTING.exposure;
    container.appendChild(this.renderer.domElement);

    // Three-light rig (all static — no animation, so no reduce-motion gating):
    //  - low AMBIENT fill so the key actually shapes the iso cubes (lit vs
    //    shadowed face = form), not a flat wash;
    //  - a warm KEY from above-and-to-one-side (wall tops + the lit cube face);
    //  - a low cool RIM from the far side for separation + depth.
    // Entities self-glow via emissive (light-independent), so the lower ambient
    // deepens floor shadow WITHOUT crushing enemies — it sharpens enemy↔floor
    // contrast rather than hiding the dark-side faces.
    this.scene.add(new AmbientLight(0xffffff, LIGHTING.ambient));
    const key = new DirectionalLight(LIGHTING.keyColor, LIGHTING.keyIntensity);
    key.position.set(KEY_LIGHT_POS.x, KEY_LIGHT_POS.y, KEY_LIGHT_POS.z);
    this.scene.add(key);
    const rim = new DirectionalLight(LIGHTING.rimColor, LIGHTING.rimIntensity);
    rim.position.set(RIM_LIGHT_POS.x, RIM_LIGHT_POS.y, RIM_LIGHT_POS.z);
    this.scene.add(rim);

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

  /** Ease the focus toward the player's interpolated position, but only once the
   *  player leaves the dead-zone — within it the focus holds still so the cube
   *  drifts on screen. `dt` is the real frame delta (camera smoothing is a
   *  render-side effect, not a sim step). */
  updateFollow(state: GameState, alpha: number, dt: number): void {
    const p = state.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);
    const k = 1 - Math.exp(-TUNING.camLerp * dt);
    const f = deadZoneFollow(this.focusX, this.focusY, px, py, TUNING.deadZone, k, this._focusOut);
    this.focusX = f.x;
    this.focusY = f.y;
    this.place();
  }

  /** Screen-shake magnitude (world units) for THIS frame; set by the loop from
   *  the game's shake timer. Applied as a transient camera jitter in place(). */
  private shakeMag = 0;
  setShake(mag: number): void {
    this.shakeMag = mag;
  }

  /** Project a floor world position to SCREEN pixels (for mouse-aim). Reused
   *  scratch — read immediately. */
  private readonly _projP = new Vector3();
  private readonly _screenPx = { x: 0, y: 0 };
  worldToScreenPx(worldX: number, worldY: number): { x: number; y: number } {
    this._projP.set(worldX, 0, worldY).project(this.camera);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this._screenPx.x = (this._projP.x * 0.5 + 0.5) * w;
    this._screenPx.y = (-this._projP.y * 0.5 + 0.5) * h;
    return this._screenPx;
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

  /** Reposition the camera so it views the current focus from the iso offset
   *  (equal x/z for the 45° yaw, +y above for the downward pitch), plus a
   *  transient shake jitter (render-only random). */
  private place(): void {
    const { offsetX, offsetY, offsetZ } = CAMERA;
    this.target.set(this.focusX, 0, this.focusY);
    let jx = 0;
    let jz = 0;
    if (this.shakeMag > 0) {
      jx = (Math.random() * 2 - 1) * this.shakeMag;
      jz = (Math.random() * 2 - 1) * this.shakeMag;
    }
    this.camera.position.set(this.focusX + offsetX + jx, offsetY, this.focusY + offsetZ + jz);
    this.camera.lookAt(this.target);
  }

  private resize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const aspect = w / h;
    const v = CAMERA.viewSize;
    // Shift the frustum window up by frameBiasY*v so the focus (player) renders
    // BELOW screen centre — a pure vertical pan of the orthographic image. The
    // view direction / up vector are untouched, so the iso ANGLE is preserved.
    const bias = CAMERA.frameBiasY * v;
    this.camera.left = -v * aspect;
    this.camera.right = v * aspect;
    this.camera.top = v + bias;
    this.camera.bottom = -v + bias;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };
}
