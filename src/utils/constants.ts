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
  /** RANGED ENEMY body (Phase 7.5) — deep crimson, a distinct shade from the
   *  chaser's pinkish-red so "all red = threat" holds while shape + tone tell the
   *  two apart at a glance. */
  enemyRanged: 0xcc1133,
  /** RANGED-ENEMY bolt — hot scarlet. Reads HOSTILE and is clearly NOT the
   *  player's blue shot (PALETTE.projectile). */
  enemyProjectile: 0xff2a4d,
  /** SWARMER body (Phase 7.6) — vermilion (red-orange), a third enemy-warm tone
   *  distinct from the chaser's pink-red and the ranged crimson. The SMALL
   *  scuttling silhouette is the primary tell; hue is secondary (crowded wheel). */
  enemySwarmer: 0xff4422,
  /**
   * VERB COLOUR PAIR (Phase 6a). Melee and ranged are pushed to opposite
   * temperature poles so they read as distinct verbs — and both stay clear of
   * the teal player body (0x33ffcc). Orange↔blue separates by hue AND luminance
   * (colourblind-robust), not hue alone.
   */
  /** MELEE — warm orange (close-range, physical). Was aliasing PALETTE.player. */
  melee: 0xff7a1a,
  /** RANGED projectile — cool electric blue (pulled out of the cyan/teal family
   *  so it no longer blurs with the player). */
  projectile: 0x4488ff,
  spark: 0xffffff,
  hitFlash: 0xffffff,
  /** Dash i-frame glow — bright cyan-white so "I'm invulnerable" reads clearly. */
  invuln: 0xaeffff,
  /** Successful-dodge confirmation flash (a dash negated a hit). */
  dodge: 0xffffff,
  // Phase 5/6 — drops + gating. Powerup drops borrow the VERB colours so the
  // drop reads as the verb it upgrades: PIERCE = projectile blue, KNOCKBACK =
  // melee orange. Health keeps its own green (it isn't a verb).
  /** Health pickup (green = restore). */
  pickupHealth: 0x44ff88,
  /** Locked-door barrier (accent red so "sealed, clear the room" reads). */
  barrier: 0xff3366,
  /** Descent stairs / floor EXIT — bright violet. A hue unused by any verb
   *  (melee orange / ranged blue), enemy (red), pickup (green) or the player
   *  (teal), so "the way down" reads instantly as its own thing (portal-like). */
  stairs: 0xb464ff,
  /** DASH powerups (extra-charge + faster-recharge) — magenta. Distinct from
   *  every other hue (player teal, health green, pierce blue, knockback orange,
   *  stairs violet, enemy/telegraph red/amber); the two dash drops share it and
   *  differ by GLYPH, since they're one system (the dash economy). */
  dash: 0xff5ad8,
} as const;

/** Same palette as CSS hex strings for the HTML HUD overlay. */
export const CSS_PALETTE = {
  background: '#0a0a12',
  floor: '#1b1b2e',
  wall: '#35356a',
  player: '#33ffcc',
  accent: '#ff3366',
  /** Verb colours for the HTML HUD (mirror PALETTE.melee / PALETTE.projectile),
   *  e.g. the active-powerup chips: knockback orange, pierce blue. */
  melee: '#ff7a1a',
  projectile: '#4488ff',
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
  /** REDUCED i-frame window for a DASH-STRIKE dash, seconds (< dashIframes): you
   *  can damage enemies but they can hit you back — the risk side of the offence. */
  dashStrikeIframes: 0.06,
  /** Base recharge time for ONE dash charge, seconds. Slower than the old 0.5
   *  cooldown so dash is a managed resource (charges refill one at a time). The
   *  FASTER-RECHARGE powerup multiplies this by dashFasterRechargeFactor. */
  dashRecharge: 1.6,
  /** FASTER-RECHARGE powerup multiplier on dashRecharge (<1 = quicker refill). */
  dashFasterRechargeFactor: 0.6,
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
  dashStrikeIframes: { min: 0, max: 0.5, step: 0.02 },
  dashRecharge: { min: 0.3, max: 4, step: 0.1 },
  dashFasterRechargeFactor: { min: 0.2, max: 1, step: 0.05 },
  hitstop: { min: 0, max: 0.2, step: 0.01 },
  shake: { min: 0, max: 1.5, step: 0.05 },
  meleeDamage: { min: 5, max: 100, step: 1 },
  rangedDamage: { min: 1, max: 50, step: 1 },
} as const;

/**
 * Softlock auto-detector (render/debug-layer instrumentation ONLY — never read
 * by the sim, never mutates state). A room is flagged "stalled" when it is
 * `active` with live enemies but the fight makes NO progress for `stallSeconds`:
 * total enemy health is not dropping, the nearest enemy is neither within
 * `engageRadius` (world units) of the player nor closing the gap by at least
 * `approachEpsilon` per check, AND no enemy is mid-attack / no bolt is in
 * flight. Tuned loose so a normal drawn-out fight (enemies pursuing, telegraph/
 * strike cycling, trading hits, kiting ranged) keeps resetting the timer — only
 * a genuinely un-killed / unreachable enemy lets it run out. tileSize is 1, so
 * world units == tile units here.
 */
export const SOFTLOCK_DETECT = {
  /** Seconds of no-progress (sim time) before the detector fires. */
  stallSeconds: 9,
  /** Nearest enemy within this many world units counts as "engaged" (reachable
   *  — the fight can still resolve), so the timer resets. */
  engageRadius: 4,
  /** Minimum nearest-distance decrease (world units) between checks that counts
   *  as "closing" — below this the enemy isn't meaningfully approaching. */
  approachEpsilon: 0.05,
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

/**
 * Touch AIM/FIRE feel (Phase 6.6). Auto-fire is gated on AIM-ENGAGED (thumb on
 * the aim ring), not on the encounter phase — so the player fires when they
 * CHOOSE to aim, and melee is the option when they don't. Fire CONTINUES toward
 * the retained last-aim for a short window after the thumb lifts, so a flick-to-
 * aim then lift-to-tap-melee/dash doesn't kill the burst (preserves the 6.5
 * thumb-overload fix). firePersistMs is the on-device tuning knob.
 */
export const AIM = {
  /** Fire persists this long (ms) after the aim thumb lifts before it stops. */
  firePersistMs: 500,
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
  /** Dash charges without any powerup. */
  baseCharges: 1,
  /** Extra charges granted by the EXTRA-CHARGE powerup (-> 2 total). */
  extraChargeBonus: 1,
} as const;

/** DASH-STRIKE powerup: a damaging dash hits enemies it sweeps through (once each,
 *  at the cost of reduced i-frames — see TUNING.dashStrikeIframes). Damage is its
 *  OWN value (not melee's) so the risk/reward is tuned independently — a touch
 *  below melee since one dash can multi-hit while moving. */
export const DASH_STRIKE = {
  /** Damage per enemy hit by a damaging dash. */
  damage: 26,
  /** Hit radius around the player centre, world units (added to ENEMY.radius). */
  radius: 0.7,
  /** Knockback impulse along the dash direction, world units/sec. */
  knockback: 8,
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

/** Ranged-ENEMY projectile (Phase 7.5) — the slow hostile bolt the ranged enemy
 *  fires. Distinct from the player's RANGED shot: slower (dodgeable), its own
 *  pool, its own scarlet sphere visual. Damage is per-enemy (depth-scaled), so
 *  it isn't here. */
export const ENEMY_PROJ = {
  /** Travel speed, world units/sec — well below the player's RANGED.speed (14) so
   *  it reads as "incoming, dodge it". */
  speed: 6.5,
  /** Collision radius, world units. */
  radius: 0.22,
  /** Time before it despawns, seconds (covers fireRange at this speed). */
  lifetime: 2.2,
} as const;

/** Enemy roster (Phase 7.5). Adding a type = a new ENEMY_TYPES entry + an AI fn +
 *  a render figure/colour — no other plumbing. Per-type SIM stats live here;
 *  generic feedback/physics shared by every type lives in ENEMY_COMMON. */
export type EnemyType = 'chaser' | 'ranged' | 'swarmer';

/** Shared across ALL enemy types (not per-type tuning). */
export const ENEMY_COMMON = {
  /** Hit-flash duration, seconds. */
  flash: 0.08,
  /** Per-second decay factor applied to knockback velocity (exp). */
  knockbackDecay: 0.0001,
  /** Max per-step MOVE as a fraction of a tile (caps the integrated move, NOT the
   *  stored knockback — the impulse still decays naturally over frames). Strictly
   *  < 1 so the single-resolve-per-axis collision (Collision.ts) can never tunnel
   *  a 1-tile wall, even at boss-scale knockback. */
  maxStepTiles: 0.9,
} as const;

export const ENEMY_TYPES = {
  /** The original Phase-2 melee chaser: chase -> telegraph -> strike -> recover. */
  chaser: {
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
    /** Collision/visual radius, world units. */
    radius: 0.4,
    /** Knockback impulse multiplier (1 = normal mass). */
    knockbackMult: 1,
  },
  /** Phase 7.5 ranged sniper: kite to range -> telegraph -> fire a slow bolt ->
   *  cooldown. FRAGILE (low HP) so closing in / sniping kills it fast — the
   *  priority target that justifies the whole player toolkit. All first-guess,
   *  playtest-tunable. */
  ranged: {
    /** LOW — dies in ~1 melee or ~2 ranged hits (chaser is 40). */
    maxHealth: 16,
    /** Kite speed (can't outrun the player, so closing always works). */
    moveSpeed: 3.4,
    /** Standoff distance it holds: kites to this, and FIRES only when at it
     *  (within rangeBand). Closing inside the band makes it back off — that's the
     *  kiting that forces the player to commit (dash/melee) to catch it. */
    preferredRange: 6,
    /** Hysteresis band around preferredRange: the fire window + anti-jitter, world
     *  units. Inside [pref-band, pref+band] it stands and fires; outside it kites. */
    rangeBand: 0.8,
    /** Wind-up before each shot, seconds (the clear, dodgeable tell). */
    telegraph: 0.7,
    /** Release window, seconds (the single shot fires once within it). */
    strike: 0.12,
    /** Cooldown after firing before it kites/fires again, seconds. */
    recover: 1.1,
    /** Projectile damage dealt to the player on hit. */
    attackDamage: 12,
    /** Collision/visual radius, world units (slighter than the chaser). */
    radius: 0.33,
    /** Knockback impulse multiplier (1 = normal mass). */
    knockbackMult: 1,
  },
  /** Phase 7.6 swarmer: a FAST, FRAGILE pack that FLOCKS to surround the player
   *  (steer toward player + separate from other swarmers) and LUNGES (a short
   *  MOVING wind-up dart, not the chaser's planted telegraph). The threat is the
   *  surround + numbers, not durability — fragility is intentional; the lever for
   *  threat is flock pressure, NOT health. All first-guess, playtest-tunable. */
  swarmer: {
    /** VERY LOW — dies to a single ranged or melee hit. Deliberately fragile;
     *  the danger is being encircled, not any one swarmer. */
    maxHealth: 10,
    /** FAST (> chaser/ranged) but still below the player's TUNING.maxSpeed (7),
     *  so the player can always create space. Used as the flock steer magnitude. */
    moveSpeed: 4.6,
    /** Low per-hit damage — pressure comes from the pack, not the individual. */
    attackDamage: 8,
    /** The lunge connects if the player is within this at the dart's strike. */
    attackReach: 1,
    /** Distance at which it commits the lunge (enters the moving wind-up). */
    lungeRange: 2.2,
    /** Moving wind-up before the dart, seconds (short — frantic but a real tell). */
    telegraph: 0.18,
    /** Dart (strike) window, seconds — drives toward the player at lungeSpeed. */
    strike: 0.12,
    /** Brief pause after a lunge before flocking again, seconds. */
    recover: 0.35,
    /** Speed of the committed lunge dart, world units/sec (fast burst). */
    lungeSpeed: 9,
    /** FLOCK separation: push off other swarmers within this radius, world units. */
    sepRadius: 1.2,
    /** Weight of the separation push relative to the pull toward the player. */
    sepWeight: 1.5,
    /** Weight of the pull toward the player. */
    attractWeight: 1,
    /** Collision/visual radius, world units (small — the scuttling silhouette). */
    radius: 0.28,
    /** Knockback impulse multiplier — LIGHT, so KNOCKBACK launches them far (sells
     *  melee crowd-control against a surrounding pack). */
    knockbackMult: 2.2,
  },
} as const;

/** Back-compat alias + the chaser baseline: existing ENEMY.* references (the
 *  chaser AI and tests) read here; per-type tuning lives in ENEMY_TYPES. */
export const ENEMY = { ...ENEMY_TYPES.chaser, ...ENEMY_COMMON } as const;

/** Fixed pool sizes — the hard ceiling on simultaneous entities. */
export const POOL = {
  projectiles: 32,
  enemies: 8,
  /** Ranged-enemy bolts in flight (separate from the player's `projectiles`). */
  enemyProjectiles: 24,
  particles: 96,
  pickups: 16,
} as const;

// ============================================================================
// ENCOUNTERS + DROPS (Phase 5) — within-run only (reset on death; persistence
// is Phase 6). All seeded/deterministic; tuned by hand at playtest.
// ============================================================================

/** Per-room encounter shape. */
export const ENCOUNTER = {
  /** Enemies spawned when a room activates (must be <= POOL.enemies). This is the
   *  BASE (depth-1) count; depth scaling adds to it (see DIFFICULTY). */
  enemiesPerRoom: 3,
  /** Radius (world units) of the spawn ring around a room's centre. */
  spawnSpread: 1.5,
} as const;

/**
 * Depth-based difficulty scaling (Phase 7c) — the ONE existing enemy type only
 * (no new AI; that's Phase 7.5). Drives off run.depth. Depth 1 = baseline
 * (multipliers = 1.0, count = ENCOUNTER.enemiesPerRoom), so floor 1 is unchanged.
 *
 * Curve (all GENTLE, linear in depth so it's smooth + monotonic, no spikes):
 *   enemiesPerRoom(d) = min(POOL.enemies, base + floor((d-1) * perDepth))
 *   mult(d)           = 1 + (d-1) * perDepthMult
 *
 * "More sometimes, harder sometimes": count rises a LITTLE (every ~2 depths) and
 * caps at the pool, while the stat multipliers carry the ramp afterwards. Tuned
 * for a good run to reach ~depth 5-6 (e.g. depth 5: ~5 enemies, ~1.7x HP, ~1.5x
 * damage, ~1.16x speed). Speed scales SMALL on purpose — fast enemies get unfair
 * quickly. Powerups CARRY across floors (7a), so the player also strengthens with
 * depth; these values are meant to out-scale that GENTLY, not trivially — the
 * knobs Craig tunes from playtest.
 */
export const DIFFICULTY = {
  /** Extra enemies per room per depth (floored). 0.5 => +1 every 2 depths. */
  enemiesPerRoomPerDepth: 0.5,
  /** Enemy max-health multiplier added per depth. */
  healthMultPerDepth: 0.18,
  /** Enemy attack-damage multiplier added per depth. */
  damageMultPerDepth: 0.12,
  /** Enemy move-speed multiplier added per depth (kept small — see above). */
  speedMultPerDepth: 0.04,
  // --- Spawn MIX (Phase 7.5): ranged enemies SUBSTITUTE for chasers within the
  // per-room count (they don't add density — keeps the count curve meaningful).
  // Deterministic count rule (no RNG), so same seed+depth => identical spawns.
  /** First depth a ranged enemy can appear (>= 2 so floor 1 is pure chaser, and
   *  the player learns the chaser + builds a toolkit before the first sniper). */
  rangedMinDepth: 3,
  /** Ranged count at rangedMinDepth. */
  rangedBase: 1,
  /** Additional ranged enemies per depth beyond rangedMinDepth (floored). 0.34 =>
   *  +1 every ~3 floors. Always clamped to leave >= 1 chaser in the room. */
  rangedPerDepth: 0.34,
  // --- Swarmer mix (Phase 7.6): SUBSTITUTE for chasers too, filling slots LEFT
  // after chasers (>=1) and ranged. Deterministic, no RNG. POOL.enemies stays 8.
  /** First depth a swarmer can appear (4 => the player meets types one at a time:
   *  chaser @1, ranged @3, swarmer @4). All three can share a room from depth 4. */
  swarmerMinDepth: 4,
  /** Swarmer count at swarmerMinDepth. */
  swarmerBase: 2,
  /** Additional swarmers per depth beyond swarmerMinDepth (floored). 0.5 => +1
   *  every 2 floors. Clamped so chasers + ranged + swarmers leave >= 1 chaser. */
  swarmerPerDepth: 0.5,
} as const;

/**
 * Descent (Phase 8a/7a). Stairs appear in the LAST-cleared room once every room
 * is cleared (so the exit lands where the final fight ended, no backtrack);
 * stepping onto them descends to the next floor. SIM values only — the visuals
 * live in STAIRS below.
 */
export const DESCENT = {
  /** Player-to-stairs distance (world units) that triggers descent on contact. */
  contactRadius: 0.9,
  /** Deterministic next-floor seed stride: nextSeed = seed + stride*depth
   *  (32-bit, via Math.imul). The golden-ratio constant, as used by dropSeed. */
  seedStride: 0x9e3779b9,
} as const;

/** Descent-stairs VISUALS (render-only; no gameplay effect). */
export const STAIRS = {
  /** Floor ring radius / tube, world units. */
  ringRadius: 0.7,
  ringTube: 0.12,
  /** Ring height above the floor, world units. */
  ringHeight: 0.06,
  /** Scale-pulse amplitude + speed (rad/s) so the active exit throbs. */
  pulseAmp: 0.12,
  pulseRate: 4,
  /** Translucency of the floor ring. */
  ringOpacity: 0.9,
  /** Billboarded "DESCEND" glyph height above the floor + on-screen size. */
  glyphHeight: 1.6,
  glyphSize: 1.1,
} as const;

/** Within-run drops. EXACTLY three kinds: health + two VERB-COUPLED powerups
 *  (PIERCE for ranged, KNOCKBACK for melee). Powerups are binary toggles — they
 *  change what a verb DOES, not its stats; not stackable; reset on death. */
export const DROP = {
  /** Chance a slain enemy drops anything (seeded roll). */
  chance: 0.45,
  /** Of the drops that happen, the share that are health (rest = a powerup,
   *  picked uniformly among the powerup kinds — see Pickup.rollDrop). */
  healthShare: 0.6,
  /** HP a health pickup restores (capped at max). */
  healAmount: 30,
  /** Knockback impulse a KNOCKBACK-melee hit applies (world units/sec). Much
   *  stronger than the base MELEE.knockback shove so the upgraded swing reads as
   *  a launcher — the behaviour change is felt, not a subtle stat nudge. */
  meleeKnockback: 18,
} as const;

/** Pickup tuning. */
export const PICKUP = {
  /** Touch-collection radius, world units. */
  radius: 0.45,
  /** Visual size (render), world units. */
  size: 0.35,
  /** Hover height above the floor (render), world units. */
  height: 0.5,
  /** Hover bob amplitude + speed (render-only). */
  bob: 0.12,
  bobRate: 3,
  /** Y-axis spin speed (radians per ms), render-only. */
  spinRate: 0.002,
  /** Floating type-icon (cross / arrow / burst) sprite size, world units. */
  iconSize: 0.7,
  /** Height of the floating icon above the pickup cube, world units. */
  iconOffset: 0.6,
} as const;

/** On-collect floating toast ("+HP" / "PIERCE" / "KNOCKBACK") — render-only
 *  feedback so the player learns what they grabbed. Pooled sprites that rise
 *  and fade. */
export const TOAST = {
  count: 8,
  /** Toast height (world units); width follows the texture aspect. */
  size: 0.9,
  /** Rise speed, world units per second. */
  rise: 1.8,
  /** Lifetime, seconds. */
  lifetime: 0.9,
  /** Initial height above the collected pickup, world units. */
  startOffset: 0.8,
} as const;

/** Locked-door barrier visuals (render-only). */
export const BARRIER = {
  /** Pooled barrier boxes (>= max doorway cells of any single room). */
  renderMax: 48,
  /** Translucency of the barrier. */
  opacity: 0.4,
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
  /** Emissive intensity of pickup meshes. */
  pickupEmissive: 0.8,
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
  /** Chaser silhouette — SQUAT + wide (a charging brute). */
  chaser: {
    bodyRadiusTop: 0.42,
    bodyRadiusBottom: 0.4,
    bodyHeight: 0.72,
    headRadius: 0.3,
    visorSize: 0.18,
  },
  /** Ranged silhouette — TALL + thin with a big head/eye (a sniper). Instantly
   *  distinct from the squat chaser at a glance, NOT a recolour. */
  ranged: {
    bodyRadiusTop: 0.18,
    bodyRadiusBottom: 0.26,
    bodyHeight: 1.18,
    headRadius: 0.26,
    visorSize: 0.24,
  },
  /** Swarmer silhouette — SMALL + low (a scuttling drone). Reads as "the fast
   *  little one" at a glance; the size is the tell, distinct from the squat
   *  chaser and the tall ranged. */
  swarmer: {
    bodyRadiusTop: 0.24,
    bodyRadiusBottom: 0.3,
    bodyHeight: 0.5,
    headRadius: 0.2,
    visorSize: 0.14,
  },
  /** Forward lean (radians) while dashing — the figure tips into the burst. */
  dashLean: 0.4,
  /** Lean ease rate toward the target lean, per second (exp smoothing). */
  leanLerp: 16,
} as const;

// ============================================================================
// DUNGEON (Phase 4) — deterministic BSP room-and-corridor generator. All tuning
// here; the generator (src/game/Dungeon.ts) is pure and seeded.
// ============================================================================
export const DUNGEON = {
  /** Floor size in tiles. */
  tilesX: 48,
  tilesY: 40,
  /** A BSP region won't split on an axis if a half would be below this. */
  minLeaf: 10,
  /** Recursion depth cap (<= 2^maxDepth leaves). */
  maxDepth: 4,
  /** Split position jitter: the split fraction is 0.5 ± up to this. */
  splitJitter: 0.12,
  /** Minimum room side, tiles (minLeaf must be >= minRoom + 2*roomPadding). */
  minRoom: 6,
  /** Gap (tiles) between a room and its BSP leaf edges — keeps the outer ring
   *  solid and rooms off the leaf seams. */
  roomPadding: 1,
  /** Corridor thickness, tiles. */
  corridorWidth: 2,
  /** Acceptance bounds for the generated room count (asserted by tests). */
  minRooms: 4,
  maxRooms: 16,
  /** Default floor seed used at startup. */
  defaultSeed: 1,
  /** Max wall boxes the renderer pools. Floors whose border-wall count exceeds
   *  this are rendered truncated and a warning is logged (see DungeonRenderer). */
  wallRenderMax: 2400,
} as const;

/**
 * Minimap overlay (Phase: render-only). A small top-right canvas schematic of
 * the floor — corridors dim, rooms brighter, the player as a dot, the current
 * room highlighted. Sizes in CSS px; colours are canvas strings (reusing the
 * CSS palette where it fits). No gameplay effect.
 */
export const MINIMAP = {
  /** Square box edge, CSS px. */
  size: 128,
  /** Inner padding before the floor schematic, CSS px. */
  padding: 6,
  /** Player marker radius, CSS px. */
  dotRadius: 3,
  colors: {
    bg: 'rgba(10, 10, 18, 0.55)',
    border: 'rgba(51, 255, 204, 0.3)',
    corridor: '#23233a',
    room: '#3b3b63',
    /** Current-room highlight (accent-tinted, translucent). */
    currentRoom: 'rgba(255, 51, 102, 0.35)',
    player: CSS_PALETTE.player,
    /** Cleared room tint (teal, subtle — "done"). */
    clearedRoom: 'rgba(51, 255, 204, 0.18)',
    /** Active (locked) room tint (amber — "fighting"). */
    activeRoom: 'rgba(255, 204, 51, 0.28)',
    /** Stairs room once active (violet — "the way down", matches PALETTE.stairs). */
    stairsRoom: 'rgba(180, 100, 255, 0.55)',
  },
} as const;

// ============================================================================
// AUDIO (Phase: combat-core SFX) — synthesized Web Audio voices, render-layer
// only (src/audio/). No audio files, ever. Frequencies in Hz, times in seconds,
// levels are linear gain 0..1. All hand-tuned; the ?debug panel can reach these
// later. The voice cap + coalesce keep a multi-kill frame from clipping.
// ============================================================================
export const AUDIO = {
  /** Master output level (the mute GainNode rides on top of this). */
  master: 0.5,
  /** Per-trigger pitch jitter, in semitones (± this), so repeats don't grate. */
  pitchJitterSemis: 1.5,
  /** Per-trigger linear-gain variance (± this fraction) for the same reason. */
  gainJitter: 0.12,
  /** Max simultaneous voices; triggers beyond this are dropped (burst safety). */
  voiceCap: 12,
  /** Same-type coalesce window, seconds: a 2nd same-type trigger within this is
   *  dropped (a multi-kill frame becomes one fatter sound, not N stacked). */
  coalesceSec: 0.04,

  /** Player ACTION blips — bright square/triangle, short envelope. */
  blip: {
    /** Attack + decay envelope, seconds. */
    attack: 0.005,
    decay: 0.09,
    /** Per-event base frequency (Hz) + waveform. */
    shoot: { freq: 660, type: 'square' as OscillatorType, gain: 0.22 },
    swing: { freq: 420, type: 'triangle' as OscillatorType, gain: 0.26 },
    dash: { freq: 300, type: 'triangle' as OscillatorType, gain: 0.24 },
  },

  /** CONTACT impacts — white-noise burst + low sine thump, fast decay. */
  impact: {
    /** Noise burst + sine envelope, seconds. */
    attack: 0.002,
    decay: 0.14,
    /** Low-end body frequency (Hz) per event + blend gains. */
    hit: { sineFreq: 180, noiseGain: 0.22, sineGain: 0.18 },
    death: { sineFreq: 110, noiseGain: 0.3, sineGain: 0.28, decay: 0.22 },
    hurt: { sineFreq: 90, noiseGain: 0.28, sineGain: 0.32, decay: 0.18 },
  },

  /** Dodge-NEGATE "whiff" — a soft filtered down-chirp (you AVOIDED the hit, so
   *  it's airy, not an impact). */
  whiff: {
    freqStart: 900,
    freqEnd: 360,
    decay: 0.16,
    gain: 0.16,
    type: 'sine' as OscillatorType,
    /** Low-pass cutoff (Hz) to keep it soft. */
    cutoff: 1200,
  },
} as const;
