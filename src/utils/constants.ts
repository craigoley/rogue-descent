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
  // Combat (Phase 2).
  enemy: 0xff4466,
  enemyTelegraph: 0xffcc33,
  projectile: 0x66e0ff,
  spark: 0xffffff,
  hitFlash: 0xffffff,
  /** Dash i-frame glow — bright cyan-white so "I'm invulnerable" reads clearly. */
  invuln: 0xaeffff,
  /** Successful-dodge confirmation flash (a dash negated a hit). */
  dodge: 0xffffff,
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
  /** Camera dead-zone radius, world units. The player can drift this far from
   *  screen centre before the camera starts following — so the cube has its own
   *  on-screen motion ("I'm moving") instead of being pinned dead-centre with
   *  the world sliding under it. 0 = classic locked-centre follow. */
  deadZone: 2,

  // --- Combat feel (Phase 2) — dialled in on-device via ?debug=1 sliders ---
  /** Dash burst distance, world units. */
  dashDist: 4.5,
  /** Invulnerability window from the start of a dash, seconds (the skill
   *  expression — dodge THROUGH an attack). */
  dashIframes: 0.18,
  /** Cooldown before the next dash, seconds. */
  dashCooldown: 0.5,
  /** Hit-stop freeze on landing an enemy hit, seconds (sells contact). */
  hitstop: 0.05,
  /** Screen-shake magnitude on taking a hit, world units of camera offset. */
  shake: 0.35,
  /** Melee damage per swing (high — rewards getting close). */
  meleeDamage: 34,
  /** Ranged damage per projectile (low — the price of safety). */
  rangedDamage: 13,
};

/** Slider bounds for the `?debug=1` tuning panel — keyed by TUNING field. Kept
 *  here so the HUD carries no magic numbers. */
export const TUNING_RANGES = {
  maxSpeed: { min: 1, max: 16, step: 0.5 },
  accel: { min: 20, max: 400, step: 10 },
  friction: { min: 20, max: 400, step: 10 },
  camLerp: { min: 1, max: 30, step: 0.5 },
  deadZone: { min: 0, max: 5, step: 0.25 },
  dashDist: { min: 1, max: 10, step: 0.5 },
  dashIframes: { min: 0, max: 0.5, step: 0.02 },
  dashCooldown: { min: 0.1, max: 2, step: 0.05 },
  hitstop: { min: 0, max: 0.2, step: 0.01 },
  shake: { min: 0, max: 1.5, step: 0.05 },
  meleeDamage: { min: 5, max: 100, step: 1 },
  rangedDamage: { min: 1, max: 50, step: 1 },
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

/**
 * Isometric follow camera (restored from Phase 1). The camera sits at an offset
 * with EQUAL horizontal components (offsetX = offsetZ) plus a height component,
 * so it looks down the room's body diagonal: a 45° YAW (the floor renders as a
 * 45° diamond, NOT a screen-aligned square) and a downward PITCH of
 * atan2(offsetY, √(offsetX²+offsetZ²)) = atan2(20, 20√2) ≈ 35.26° (classic iso).
 * A cube viewed down this body diagonal shows three faces (top + two sides),
 * projecting as a hexagonal silhouette — true 3D, not a flat top-down tile.
 *
 * PR #8 zeroed offsetX to chase grid-alignment, collapsing the yaw to 0 and
 * flattening the view. Grid-tracking is abandoned: the cube moves diagonally
 * across the diamond (standard for iso action games), which is intended.
 */
export const CAMERA = {
  /**
   * Half-height of the orthographic frustum, world units. Smaller than the room
   * (14) so the follow actually scrolls — the room edges move past the player.
   */
  viewSize: 6,
  /** Horizontal offset along world x. Equal to offsetZ => 45° camera yaw. */
  offsetX: 20,
  /** Height above the floor plane (sets the pitch together with offsetX/offsetZ). */
  offsetY: 20,
  /** Horizontal offset along world z. Equal to offsetX => 45° camera yaw. */
  offsetZ: 20,
  near: 0.1,
  far: 200,
  /**
   * Vertical FRAMING bias, as a fraction of viewSize. Shifts the orthographic
   * frustum window up so the focus (player) sits below screen centre — leaving
   * headroom above for approaching enemies and pushing the empty foreground
   * floor down behind the bottom controls. This is a pure 2D pan of the image:
   * it does NOT change the camera's view direction or the iso ANGLE (the cube
   * still shows its 3-face hexagonal silhouette). Tune by eye on a portrait phone.
   */
  frameBiasY: 0.18,
} as const;

/**
 * Iso INPUT rotation, radians. Raw input is in SCREEN axes (+x right, +y down)
 * and the pure game layer rotates it by −ISO_YAW into the world floor plane so
 * "up" on screen moves the player up the screen. The rotation must cancel the
 * camera's horizontal yaw, so it is DERIVED from the camera offset:
 * atan2(offsetX, offsetZ). With the restored iso camera (offsetX = offsetZ) this
 * is the real 45° (π/4): input "up" → a world DIAGONAL that still projects
 * straight up the screen under the yawed camera (up=up holds; movement runs
 * diagonally across the diamond, which is intended). Player's rotation code is
 * UNCHANGED; this derived value tracks whatever yaw the camera offset implies.
 */
export const ISO_YAW = Math.atan2(CAMERA.offsetX, CAMERA.offsetZ);

/** Key directional light position (absolute world coordinates, derived from
 *  camera offsets so the light tracks the camera angle automatically). */
export const KEY_LIGHT_POS = {
  x: CAMERA.offsetZ * 0.4,
  y: CAMERA.offsetY * 1.5,
  z: CAMERA.offsetZ * 0.6,
} as const;

/** Touch virtual-stick tuning. */
export const TOUCH = {
  /** Drag distance (px) from the stick origin that maps to full deflection. */
  range: 60,
  /** Aim stick resting position: right-edge inset, px. */
  aimHomeMargin: 28,
  /** Aim stick resting position: vertical fraction of viewport height. */
  aimHomeY: 0.6,
  /** Desktop controls-hint auto-fade delay, ms. */
  hintFadeMs: 7000,
} as const;

// ============================================================================
// COMBAT (Phase 2). Feel values that benefit from on-device tuning live in
// TUNING above (sliders). Structural values — ranges, durations, pool sizes —
// live here. All pools are FIXED-SIZE and reused; nothing allocates per frame.
// ============================================================================

/** Player combat/health (non-feel). maxHealth is a fixed cap per the design. */
export const PLAYER_COMBAT = {
  maxHealth: 100,
  /** Hit-flash duration on taking damage, seconds. */
  hitFlash: 0.1,
  /** Brief i-frames after being hit, so one strike can't multi-hit, seconds. */
  hitInvuln: 0.4,
  /** Dead time before the room auto-resets, seconds. */
  deathPause: 1.0,
  /** Render-tell duration when a dash i-frame negates a hit (the "dodge!"
   *  confirmation flash). VISIBILITY only — the i-frame timing is unchanged. */
  dodgeFx: 0.28,
  /** Tiny freeze-frame on a successful dodge — a cheap time-dilation cue so the
   *  dodge FEELS earned. Reuses the existing hit-stop mechanism, seconds. */
  dodgeHitstop: 0.07,
  /** How long the one-time dodge tutorial stays on screen, seconds. */
  dodgeTutorialDuration: 3.5,
} as const;

/** Dash shape. Distance + i-frames + cooldown are in TUNING (tunable). */
export const DASH = {
  /** Burst duration, seconds. dash speed = TUNING.dashDist / duration. */
  duration: 0.16,
} as const;

/** Melee swing. Damage is in TUNING. */
export const MELEE = {
  /** Reach from the player centre, world units. */
  range: 1.7,
  /** Half-angle of the swing arc, radians (~60° each side => 120° arc). */
  halfArc: 1.05,
  /** Render/active window of the swing, seconds. */
  active: 0.1,
  /** Cooldown between swings, seconds. */
  cooldown: 0.38,
  /** Knockback impulse applied to a hit enemy, world units/sec. */
  knockback: 7,
} as const;

/** Ranged shot. Damage is in TUNING. */
export const RANGED = {
  /** Projectile speed, world units/sec. */
  speed: 14,
  /** Fire interval, seconds. */
  cooldown: 0.22,
  /** Projectile collision radius, world units. */
  radius: 0.18,
  /** Time before a projectile despawns, seconds. */
  lifetime: 1.2,
  /** Knockback impulse applied to a hit enemy, world units/sec. */
  knockback: 3,
} as const;

/** The one enemy type: chase -> telegraph -> strike -> recover. */
export const ENEMY = {
  maxHealth: 40,
  /** Chase speed, world units/sec (slower than the player so kiting works). */
  moveSpeed: 3.3,
  /** Distance at which it stops and begins the telegraph, world units. */
  attackRange: 1.3,
  /** Wind-up before the strike, seconds (the dodge window). */
  telegraph: 0.55,
  /** Strike active window, seconds. */
  strike: 0.12,
  /** Post-strike pause before chasing again, seconds. */
  recover: 0.45,
  /** Damage dealt by a connecting strike. */
  attackDamage: 18,
  /** A strike connects if the player is within this distance at strike time. */
  attackReach: 1.7,
  /** Hit-flash duration, seconds. */
  flash: 0.08,
  /** Collision/visual radius, world units. */
  radius: 0.4,
  /** Per-second decay factor applied to knockback velocity (exp). */
  knockbackDecay: 0.0001,
} as const;

/** Fixed pool sizes — the hard ceiling on simultaneous entities. */
export const POOL = {
  projectiles: 32,
  enemies: 8,
  particles: 96,
} as const;

/** Hit-spark particles (pure, deterministic spread — no RNG in the sim). */
export const PARTICLE = {
  lifetime: 0.4,
  speed: 5,
  /** Per-step drag multiplier (sim runs at fixed SIM_DT). */
  drag: 0.9,
  /** Particles emitted per enemy hit. */
  hitCount: 7,
  /** Particles emitted on enemy death. */
  deathCount: 16,
  /** "Whiff" sparks emitted when a dash dodges a hit (the dodge burst). */
  dodgeCount: 12,
} as const;

/** Screen shake decay window, seconds (magnitude is TUNING.shake). */
export const SHAKE = {
  duration: 0.25,
} as const;

/** Render-only VFX dimensions (no gameplay effect). */
export const VFX = {
  /** Dash afterimage count. */
  trailLength: 6,
  /** Height above the floor for projectiles / sparks, world units. */
  projectileHeight: 0.35,
  /** Hit-spark cube size, world units. */
  particleSize: 0.12,
  particleHeight: 0.25,
  /** Resting emissive intensity of the player cube (no combat state). */
  playerEmissive: 0.4,
  /** Emissive intensity of the player cube while dash i-frames are active (vs
   *  the resting playerEmissive) — the cube glows so invuln is unmistakable. */
  invulnEmissive: 1.5,
  /** Scale-pulse amplitude during i-frames / a dodge (a subtle "powered" throb). */
  invulnPulse: 0.14,
  /** Scale-pulse speed during i-frames / a dodge, radians per second. */
  invulnPulseRate: 16,
  /** Emissive intensity at the peak of a successful-dodge confirmation flash. */
  dodgeEmissive: 2.4,
  /** Dash trail afterimage peak opacity. */
  trailOpacity: 0.35,
  /** Enemy telegraph max scale boost (1 + this at full wind-up). */
  telegraphScale: 0.3,
  /** Melee arc indicator Y position above the floor, world units. */
  meleeArcHeight: 0.05,
  /** Melee arc indicator peak opacity. */
  meleeArcOpacity: 0.5,
  /** Resting emissive intensity of an enemy figure. */
  enemyEmissive: 0.25,
  /** Emissive intensity of the front visor "eye" (the facing indicator) so it
   *  reads as a bright neon glow regardless of body state. */
  visorEmissive: 1.3,
} as const;

/**
 * Procedural humanoid FIGURE dimensions (Phase 3) — render-only, composed from
 * CylinderGeometry (body) + SphereGeometry (head) + a small front visor box (the
 * facing indicator). NO CapsuleGeometry (banned per fleet note). Distinct
 * silhouettes: the player is taller + slimmer, the enemy shorter + bulkier with
 * a bigger head. World units; the figure stands with its feet at y = 0.
 */
export const FIGURE = {
  /** Cylinder/sphere radial segments — low enough for the faceted neon look. */
  segments: 10,
  player: {
    bodyRadiusTop: 0.26,
    bodyRadiusBottom: 0.32,
    bodyHeight: 1.0,
    headRadius: 0.24,
    visorSize: 0.16,
  },
  enemy: {
    bodyRadiusTop: 0.42,
    bodyRadiusBottom: 0.4,
    bodyHeight: 0.72,
    headRadius: 0.3,
    visorSize: 0.18,
  },
  /** Forward lean (radians) while dashing — the figure tips into the burst. */
  dashLean: 0.4,
  /** Lean ease rate toward the target lean, per second (exp smoothing). */
  leanLerp: 16,
} as const;

/** Enemy spawn points for the test room (open floor tiles, world units). One
 *  enemy type only — these are just placements for the feel test. */
export const ENEMY_SPAWNS = [
  { x: 4, y: 5 },
  { x: 10, y: 5 },
  { x: 7, y: 10 },
] as const;
