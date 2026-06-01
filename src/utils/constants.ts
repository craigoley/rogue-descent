/**
 * ALL tuning values live here. No magic numbers anywhere else in the codebase.
 *
 * The pure game layer works on a flat floor plane in world units: `x` runs
 * left/right, `y` runs near/far (depth). The rendering layer maps those onto
 * three.js axes (game x -> three x, game y -> three z) and views the plane
 * through an OrthographicCamera tilted to an isometric angle. Speeds are
 * world-units per second.
 */

/** Dungeon palette as 0xRRGGBB numbers for the three.js / rendering layer. */
export const PALETTE = {
  background: 0x0a0a12,
  floor: 0x1b1b2e,
  floorLine: 0x2c2c4a,
  wall: 0x35356a,
  wallTop: 0x4a4a8c,
  player: 0x33ffcc,
  accent: 0xff3366,
} as const;

/** Same palette as CSS hex strings for the HTML HUD overlay. */
export const CSS_PALETTE = {
  background: '#0a0a12',
  floor: '#1b1b2e',
  wall: '#35356a',
  player: '#33ffcc',
  accent: '#ff3366',
} as const;

/** Fixed simulation timestep, in seconds (the sim updates at 60 Hz). The render
 *  loop accumulates real frame time and steps the sim in fixed SIM_DT slices,
 *  interpolating the remainder so motion is smooth at any refresh rate. */
export const SIM_DT = 1 / 60;

/**
 * Maximum frame delta (seconds) fed to the loop. Caps catch-up after a
 * tab-switch / stall so the accumulator can't trigger a spiral of death.
 */
export const MAX_FRAME_DT = 0.25;

/**
 * Live-tunable movement + camera feel. DELIBERATELY mutable (not `as const`):
 * the `?debug=1` panel writes to these fields so the feel can be dialled in
 * on-device without a rebuild. The pure game layer READS them; the DOM slider
 * (rendering layer) WRITES them. The values below are the starting point.
 *
 * Snappy = high accel/friction so the velocity ramp resolves in ~2-3 sim steps
 * — near-instant, but with the tiny ramp that separates "responsive" from the
 * lifeless feel of setting position directly.
 */
export const TUNING = {
  /** Top movement speed, world units per second. */
  maxSpeed: 7,
  /** Acceleration toward target velocity, world units/sec^2. At 150 the ramp
   *  0 -> maxSpeed takes ~2.8 sim steps (150/60 = 2.5 u/s gained per step). */
  accel: 150,
  /** Deceleration toward rest when input releases, world units/sec^2. Slightly
   *  below accel for a stop that feels solid, not jittery. */
  friction: 140,
  /** Camera follow rate, per second (exponential smoothing). Higher = tighter
   *  to the player; lower = floatier. */
  camLerp: 10,
};

/** Slider bounds for the `?debug=1` tuning panel — keyed by TUNING field. Kept
 *  here so the HUD carries no magic numbers. */
export const TUNING_RANGES = {
  maxSpeed: { min: 1, max: 16, step: 0.5 },
  accel: { min: 20, max: 400, step: 10 },
  friction: { min: 20, max: 400, step: 10 },
  camLerp: { min: 1, max: 30, step: 0.5 },
} as const;

/** Player body tuning. */
export const PLAYER = {
  /** Collision half-extent AND visual half-size, world units. The player is
   *  treated as an axis-aligned box of side 2*radius for tilemap collision. */
  radius: 0.4,
} as const;

/** Shared room geometry (per-tile). Tile counts come from the layout below. */
export const ROOM = {
  /** Side length of one floor tile, world units. */
  tileSize: 1,
  /** Wall height, world units (rendering reads this for box geometry). */
  wallHeight: 1.2,
} as const;

/**
 * The Phase 1 TEST ROOM — HAND-AUTHORED, not procedurally generated (the
 * generator is Phase 3; a random room would confound the feel test). `#` is a
 * solid wall, `.` is floor. 14x14, with four interior pillars so wall-slide can
 * be felt against interior corners in every direction, and an open centre to
 * spawn into. Row 0 is the far (-y) edge; column 0 is the left (-x) edge.
 */
export const TEST_ROOM = [
  '##############',
  '#............#',
  '#..##....##..#',
  '#..##....##..#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#..##....##..#',
  '#..##....##..#',
  '#............#',
  '##############',
] as const;

/** Isometric follow camera. */
export const CAMERA = {
  /**
   * Half-height of the orthographic frustum, world units. Smaller than the room
   * (14) so the follow actually scrolls — the room edges move past the player.
   */
  viewSize: 6,
  /** Camera offset from its focus along each axis (equal -> classic iso angle,
   *  preserved from Phase 0). */
  offset: 20,
  near: 0.1,
  far: 200,
} as const;

/**
 * Iso INPUT rotation, radians. The camera sits at equal +x/+z offsets from its
 * focus, so its view is yawed `atan2(offsetZ, offsetX)` about the vertical axis
 * (= 45° while the offsets are equal). Raw input is expressed in SCREEN axes
 * (+x right, +y down) and the pure game layer rotates it by −ISO_YAW into the
 * world floor plane, so "up" on screen moves the player up the screen instead of
 * along a diagonal world axis. DERIVED from CAMERA.offset so it tracks the iso
 * angle automatically — never hard-code the 0.785.
 */
export const ISO_YAW = Math.atan2(CAMERA.offset, CAMERA.offset);

/** Touch virtual-stick tuning. */
export const TOUCH = {
  /** Drag distance (px) from the stick origin that maps to full deflection. */
  range: 60,
} as const;
