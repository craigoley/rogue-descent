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

/** Fixed simulation timestep, in seconds (the game updates at 60 Hz). */
export const TIMESTEP = 1 / 60;

/**
 * Maximum frame delta (seconds) fed to the loop. Caps catch-up after a
 * tab-switch / stall so the accumulator can't trigger a spiral of death.
 */
export const MAX_FRAME_DT = 0.25;

/** Player tuning. */
export const PLAYER = {
  /** Movement speed, world units per second. */
  speed: 6,
  /** Collision/visual radius, world units. Keeps the body off the walls. */
  radius: 0.4,
} as const;

/** The single placeholder room. Dimensions are in tiles; tiles are square. */
export const ROOM = {
  /** Floor extent along world x, in tiles. */
  tilesX: 16,
  /** Floor extent along world y (depth), in tiles. */
  tilesY: 12,
  /** Side length of one floor tile, world units. */
  tileSize: 1,
  /** Wall height, world units (rendering reads this for box geometry). */
  wallHeight: 1.2,
} as const;

/** Isometric camera framing. */
export const CAMERA = {
  /**
   * Half-height of the orthographic frustum, world units. The visible width is
   * derived from the viewport aspect ratio so the room fits on any screen.
   */
  viewSize: 11,
  /** Camera offset from its target along each axis (equal -> classic iso). */
  offset: 20,
  near: 0.1,
  far: 200,
} as const;
