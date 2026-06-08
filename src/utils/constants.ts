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
  /** BOSS body (Phase 8) — dark armored maroon: clearly "boss", distinct from the
   *  three brighter enemy reds. The SIZE + HP bar are the primary tells. */
  enemyBoss: 0x7a1020,
  /** BOSS phase-2 escalation tint — hotter/brighter so "it got angrier" reads. */
  enemyBossPhase2: 0xc81830,
  /** BOSS weak-point glow — bright amber: the VULNERABLE side you must hit
   *  (positioning gimmick). Reuses the telegraph-warning language. */
  enemyBossWeak: 0xffcc33,
  /** BOSS shield "blocked" flash — cold steel: a hit from the armored side did
   *  nothing (reposition to the weak-point). */
  enemyBossShield: 0x88aacc,
  /** BOSS STAGGER tint (gimmick #3): a knockback hit CANCELLED its CLEAVE windup —
   *  bright mint-cyan, distinct from the white hit-flash, amber telegraph, steel
   *  shield and red body, so "you broke its attack / shield's down" reads at a
   *  glance during the free-hit window. */
  enemyBossStagger: 0x66ffd0,
  /** BOSS ADD body (Phase 8, gimmick #2) — ember orange: warm (reads "threat")
   *  but lighter/oranger than the chaser pink-red, ranged crimson, swarmer
   *  vermilion and boss maroon, so a summoned minion reads as its own weak,
   *  glowing thing. */
  enemyBossAdd: 0xff8a3c,
  /** STUNNED enemy tint (Phase 9 PR2) — a cold, desaturated grey-blue: clearly
   *  "disabled / dazed", pulled OUT of the warm enemy-threat reds so the CC reads
   *  at a glance. Distinct from the white hit-flash, amber telegraph, and steel
   *  boss-shield. */
  enemyStunned: 0x6f8aa6,
  /** BURNING enemy tint (synergy arc PR2) — ember orange: a hot DoT glow distinct
   *  from the stun grey-blue, telegraph amber, and the enemy-threat reds, so "it's
   *  on fire" reads at a glance. Hotter/brighter than the boss-add ember. */
  enemyBurning: 0xff6620,
  /** CHAIN arc bolt (synergy arc PR3) — electric blue-white: a lightning arc between
   *  chained enemies, distinct from the warm enemy/burn tones and the player teal. */
  chainArc: 0x9fe8ff,
  /** CRIT (synergy arc PR4) — bright gold: the crit chip + world drop. A "jackpot"
   *  hue distinct from every other effect (lifesteal crimson, burn ember, chain
   *  blue) and the verb tracks. */
  crit: 0xffd23f,
  /** GOLDEN CHEST body (golden chests) — warm amber-gold, distinct from the brighter
   *  crit gold, so a chest reads as "treasure" from across the room. */
  chest: 0xffb300,
  /** GOLDEN CHEST trim/clasp — dark bronze: the band + lock accent that make the gold
   *  box read as a chest, not a cube. */
  chestTrim: 0x6e4a12,
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
  /** LIFESTEAL pickup/effect colour (synergy arc) — blood crimson; mirrors
   *  CSS_PALETTE.lifesteal for the world drop glyph. */
  lifesteal: 0xff4060,
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
  /** EFFECT-axis chip colour (synergy arc) — blood crimson for LIFESTEAL, a new hue
   *  distinct from the orange/blue stat-tracks so on-hit EFFECTS read as their own
   *  (uncommon) tier. Burn/chain/crit will get their own effect hues. */
  lifesteal: '#ff4060',
  /** BURN effect-axis chip colour (synergy arc PR2) — ember orange (mirrors
   *  PALETTE.enemyBurning). */
  burn: '#ff6620',
  /** CHAIN effect-axis chip colour (synergy arc PR3) — electric blue-white (mirrors
   *  PALETTE.chainArc). */
  chain: '#9fe8ff',
  /** CRIT effect-axis chip colour (synergy arc PR4) — bright gold (mirrors PALETTE.crit). */
  crit: '#ffd23f',
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

/** Full-screen damage VIGNETTE (Phase: juice). A red edge-glow that pulses when the
 *  player takes damage — the genre-standard "I got hit" signal, stronger than the
 *  small centred cube-flash on the iso view. RENDER-ONLY: the HUD drives the overlay
 *  opacity from player.hitFlashTimer (already set by the sim on damage), so it pulses
 *  + fades in lockstep with the cube flash — NO new sim state / second duration. */
export const VIGNETTE = {
  /** Opacity at the instant of a hit (fades to 0 with hitFlashTimer). By-feel. */
  peakOpacity: 0.35,
  /** Reduce-motion peak: the vignette is INFORMATION ("you got hit"), not motion, so
   *  accessibility softens it but KEEPS it (vs camera shake, which goes to 0). By-feel. */
  reducedOpacity: 0.15,
} as const;

/** Dash shape. Distance + i-frames + cooldown are in TUNING (tunable). */
export const DASH = {
  /** Burst duration, seconds. dash speed = TUNING.dashDist / duration. */
  duration: 0.16,
  /** Dash charges without any powerup. */
  baseCharges: 1,
  /** Extra charges per EXTRA-CHARGE level (×extraChargeLevel). */
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

/** SYNERGY ARC — PR1 LIFESTEAL (the first on-hit EFFECT axis). Heal a fraction of
 *  DIRECT-hit damage dealt. Hooks the shared damageEnemy choke point, so it
 *  auto-multiplies with melee-dmg / multishot (N hits) / pierce (N hits) /
 *  dash-strike for free (the emergent-synergy spine — no combo code). Leveled like
 *  the stat tracks. Bounds (decision E): DoT/tick damage is EXCLUDED (PR2 burn ticks
 *  pass isDirect=false), and each hit's heal is capped (so a future crit×lifesteal
 *  spike can't full-heal off one hit). All by-feel — tune on replay. */
export const LIFESTEAL_LEVELS = {
  /** Heal fraction of damage dealt, per level (0 = none). Modest = sustain, not
   *  invincibility: I 4%, II 7%, III 10%. */
  frac: [0, 0.04, 0.07, 0.1],
  /** Hard cap on HP healed from a SINGLE hit — bounds the crit×lifesteal /
   *  big-amount spike so lifesteal stays sustain, never a panic full-heal. */
  maxPerHit: 12,
} as const;

/** SYNERGY ARC — PR2 BURN (the marquee DoT effect axis). A DIRECT hit IGNITES the
 *  enemy; burn then TICKS damage over time through the SAME damageEnemy choke point
 *  with isDirect=false, so it (a) never lifesteals (#66 guard), (b) never re-ignites
 *  itself, (c) never knocks back, and (d) hits the normal death / kill / drop path.
 *  One apply hook in damageEnemy → auto-multiplies with multishot (N ignitions) /
 *  pierce (ignite the line) / dash-strike. REFRESH-not-stack: re-igniting resets the
 *  duration + sets dps-by-level (overwrite) — no infinite scaling. All by-feel. */
export const BURN_LEVELS = {
  /** Burn damage-per-second, per level (0 = none). Continuous (dps × dt per tick).
   *  Modest: over `duration` a maxed burn ≈ one chaser's HP — strong but not an
   *  instant delete; the SPREAD (many enemies lit) is the payoff, not single-target
   *  burst (refresh caps single-target dps at the flat rate). I 6 / II 9 / III 12. */
  dps: [0, 6, 9, 12],
  /** How long one ignition burns, seconds (RESET on re-hit, never extended past
   *  this). Long enough to matter while kiting, short enough to need re-applying. */
  duration: 2.5,
} as const;

/** SYNERGY ARC — PR3 CHAIN (a direct hit ARCS to nearby enemies). The headline
 *  cross-axis combo: chain × burn = WILDFIRE (each arc carries burn-ignite → the
 *  pack catches fire). The MOST degenerate-prone axis, so its bounds are baked in:
 *  a hard JUMP CAP, per-jump damage FALLOFF, dedupe (no A→B→A), and NO re-chain
 *  (type-enforced — only a 'direct' hit triggers chain; arcs are 'chain' hits). The
 *  arc routes through damageEnemy('chain') so it inherits burn + the death/kill/drop
 *  path, but NOT lifesteal and NOT another chain. All by-feel — tune on replay. */
export const CHAIN_LEVELS = {
  /** Extra enemies an arc hits, per level (0 = none; III = 3 jumps). The chain loop
   *  runs at MOST maxJumps[level] times — never unbounded. */
  maxJumps: [0, 1, 2, 3],
  /** Max distance (world units) from the current link to the next un-hit enemy.
   *  Keeps the arc local (a pack), not a screen-wide teleport. */
  range: 4,
  /** Damage multiplier applied per jump (compounds): jump 1 = base×falloff, jump 2 =
   *  base×falloff², ... So chain is SPREAD/utility, not a single-target nuke. */
  falloff: 0.6,
} as const;

/** SYNERGY ARC — PR4 CRIT (the FINALE; the "multiplier glue"). A direct hit has a
 *  per-level CHANCE to deal ×multiplier damage. Rolls inside damageEnemy on the
 *  'direct' hit-kind (a seeded combatRng draw), multiplying the damage BEFORE
 *  lifesteal + chain read it — so a crit spikes the heal AND the whole wildfire base
 *  FREE (arcs falloff from the bigger base; no per-arc rolls). The burn DoT is
 *  deliberately NOT pumped (it keys off level, preserving its spread-not-burst
 *  identity + bounding the compound). CHANCE scales by level; the MULTIPLIER is fixed
 *  (a growing multiplier would compound with everything → degenerate). By-feel. */
export const CRIT_LEVELS = {
  /** Crit CHANCE per level (0 = never): I 10% / II 20% / III 30%. */
  chance: [0, 0.1, 0.2, 0.3],
  /** Fixed damage multiplier on a crit. At max that's +30% average direct damage,
   *  spiking to ×2 on the crit itself — a burst that uses the wildfire headroom
   *  without trivializing (grants no i-frames/CC; the dodge core survives). */
  multiplier: 2,
} as const;

/** SYNERGY ARC — PR4 CRIT feel (render-fed-by-sim, like the base hit-stop). A crit
 *  gets a STRONGER, longer freeze than a normal hit (TUNING.hitstop 0.05) — the
 *  time-dilation "crunch" is the cheapest, strongest crit feel. */
export const CRIT = {
  /** Hit-stop on a crit, seconds (> TUNING.hitstop). */
  hitstop: 0.09,
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
export type EnemyType = 'chaser' | 'ranged' | 'swarmer' | 'boss' | 'bossadd';

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
  /** Phase 8 BOSS: a bespoke, large, two-phase enemy in the LAST room of every
   *  floor that gates descent. It's a pooled Enemy (reuses damage/clearing/
   *  gating) but its rich behaviour lives in state.boss (see Boss.ts); its
   *  per-attack timings come from the attack table (BOSS), not these fields.
   *  Big radius + high base HP (depth-scaled at spawn). HEAVY (knockbackMult < 1
   *  so it isn't trivially shoved). attackDamage/reach/telegraph here are the
   *  baseline slam the attack table uses. */
  boss: {
    /** Base HP — depth-scaled by healthMultForDepth at spawn (NON-sponge: the
     *  gimmick + telegraphs are the test, not the HP; tuned at playtest). */
    maxHealth: 220,
    /** Slow — it holds the arena and rotates its shield; the player circles it. */
    moveSpeed: 2,
    /** Baseline slam damage (depth-scaled at spawn). */
    attackDamage: 20,
    /** Slam connects within this distance at strike time (an AoE-ish reach). */
    attackReach: 2.6,
    /** Big, clear wind-up before a slam, seconds (NON-sponge: very readable). */
    telegraph: 0.9,
    /** Slam active window, seconds. */
    strike: 0.2,
    /** Pause after a slam before the next attack, seconds. */
    recover: 0.8,
    /** Large collision/visual radius (fits minRoom 6 with the room-rect clamp). */
    radius: 1.4,
    /** HEAVY — resists knockback (the boss isn't a swarmer to fling around). */
    knockbackMult: 0.25,
  },
  /** BOSS ADD (Phase 8, gimmick #2) — a weak minion the boss SUMMONS in phase 2.
   *  GLASSY (dies to ~1-2 ranged/pierce hits) and marches STRAIGHT at the player
   *  (no kiting, no flock-surround) so a summoned line rewards PIERCE and can be
   *  thinned at range before it closes. It is PRESSURE, not a second fight: few,
   *  finite, and despawned when the boss dies. Reuses the chaser-style
   *  chase->telegraph->strike->recover melee, with its OWN weak timings/stats. */
  bossadd: {
    /** GLASSY base HP — ~one ranged shot (13) at shallow depth, two when scaled. */
    maxHealth: 12,
    /** Modest march speed (below the player so the line can be kited + pierced). */
    moveSpeed: 3,
    /** Distance at which it stops and telegraphs its melee, world units. */
    attackRange: 1.2,
    /** Wind-up before the strike, seconds (a real, dodgeable tell). */
    telegraph: 0.5,
    /** Strike active window, seconds. */
    strike: 0.12,
    /** Post-strike pause before marching again, seconds. */
    recover: 0.5,
    /** LOW melee damage — the threat is split focus, not the individual add. */
    attackDamage: 8,
    /** A strike connects within this distance at strike time, world units. */
    attackReach: 1.4,
    /** Small collision/visual radius (a minor, scuttling summoned thing). */
    radius: 0.3,
    /** Knockback multiplier — light, so melee shoves them off the boss easily. */
    knockbackMult: 1.6,
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
  /** Chain-arc bolts visible at once (synergy arc PR3). A maxed chain is ≤3 jumps;
   *  with multishot several can fire in a frame, so a small pool covers a volley. */
  chainArcs: 24,
  /** Golden chests per floor (1-2 spawned; small pool with margin). */
  chests: 4,
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
  // --- Boss (Phase 8): HP/damage reuse the mult curves above; these add the
  // boss-specific depth rules. Shallow bosses are a gentle teach (single phase);
  // the two-phase escalation arrives deeper.
  /** First depth the boss runs TWO phases (escalate at 50% HP). Below it the boss
   *  is single-phase (never escalates) — a lighter teaching fight. */
  bossTwoPhaseMinDepth: 3,
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

/** GOLDEN CHESTS (risk/reward loot). A chest spawns in 1-2 non-spawn, non-boss rooms
 *  per floor; opening it (contact, only once the room is CLEARED) pops TWO linked
 *  pickups — walk over one, the other vanishes (the spatial 1-of-2 choice). PR1 =
 *  always loot; PR2 adds the mimic roll. All by-feel. */
export const CHEST = {
  /** Chests per floor (inclusive range, picked per seed). */
  minPerFloor: 1,
  maxPerFloor: 2,
  /** Open reach by contact, world units (added to PLAYER.radius). */
  openReach: 0.7,
  /** Spatial offset of each of the 2 popped pickups from the chest centre, world
   *  units — far enough apart that walking to one is a clear spatial commitment. */
  pickupOffset: 1.2,
  /** Spark burst emitted on opening (the lid-pop tell). */
  openBurst: 18,
  // --- RENDER (render-only): a beveled chest = a BASE box + a hinged LID + trim band
  //     + a front clasp, gold with an emissive "treasure" glow. ---
  /** Footprint (width/depth) of the chest body, world units. */
  bodySize: 0.7,
  /** Base box height + lid box height, world units. */
  baseHeight: 0.42,
  lidHeight: 0.22,
  /** Hover baseline (chest centre height above the floor) + bob amplitude/rate. */
  bodyHeight: 0.35,
  bobAmp: 0.05,
  bobRate: 3,
  /** Gentle idle SWAY (rotation oscillation, radians + rate) — reads as a chest
   *  beckoning, not a spinning coin. Stilled when reduce-motion is on. */
  swayAmp: 0.12,
  swayRate: 1.6,
  /** Emissive glow: base intensity + an idle PULSE (amplitude/rate) so the unopened
   *  chest says "valuable, come get me". The pulse stills on reduce-motion; the base
   *  glow stays (it's not motion). */
  emissive: 0.4,
  glowPulseAmp: 0.22,
  glowPulseRate: 2.2,
  /** THE OPEN MOMENT (render-only, frame-diffed off the sim `opened`): the lid flings
   *  open over `openDuration` seconds to `lidOpenAngle` radians, with a brief scale
   *  POP — anticipation (closed+glowing) -> pop (lid+burst) -> reveal (the 2 picks).
   *  MIMIC-READY: PR-C adds a sim wobble signal that the renderer plays here BEFORE
   *  the lid opens (the structure — group + hinged lid pivot — already supports it). */
  openDuration: 0.45,
  lidOpenAngle: 2.2,
  openPopScale: 0.15,
} as const;

/** Within-run drops. Health + seven powerups: four LEVELED weapon tracks (Phase 9:
 *  melee, ranged, pierce, knockback — stack to tier III) and three binary DASH
 *  toggles (extra-charge, faster-recharge, dash-strike). Reset on death. */
export const DROP = {
  /** Chance a slain enemy drops anything (seeded roll). Tuned DOWN from 0.45 —
   *  drops were too frequent (every kill rolls: regular enemies + the boss +
   *  player-killed adds). By-feel; re-tune on replay. */
  chance: 0.3,
  /** Of the drops that happen, the share that are HEALTH (rest = a powerup, picked
   *  by the weighted roll — see Pickup.rollDrop). Raised 0.6 -> 0.78 now that GOLDEN
   *  CHESTS (#70) are the deliberate powerup/effect source: the floor leans toward
   *  health, and floor powerups roughly HALVE (the 0.4 powerup branch -> 0.22) so
   *  they stop doubling up with chests. Net per kill (×chance 0.3): ~23% health,
   *  ~7% powerup (was 18% / 12%). By-feel; re-tune on replay. */
  healthShare: 0.78,
  /** Suppress a rolled HEALTH drop when the player is at/above this fraction of
   *  max HP — a health pickup at (near-)full just clamps to max, so spawning one
   *  is useless litter that reads as drop spam. The roll still happens (seed-
   *  deterministic); only the SPAWN is skipped (see Encounter.rollAndSpawnDrop).
   *  Makes health drops appear when you actually need them. By-feel. */
  healthSuppressAboveFrac: 0.9,
  /** Phase 9 SCARCITY — per-level ACCEPTANCE probability for a rolled POWERUP,
   *  indexed by the player's CURRENT level in that track (the level you'd advance
   *  FROM). Reaching tier III is EARNED without a stingy entry: 0->I always (entry
   *  quick), I->II 60%, II->III 30%, already-maxed (3) 0% (reject — no wasted
   *  drop). Binary powerups read as level 0 (unowned) or max (owned), so an owned
   *  repeat is rejected too. A reject = no spawn (post-roll filter beside the
   *  health suppression). Replaces the decay idea; by-feel. */
  powerupAcceptByLevel: [1.0, 0.6, 0.3, 0.0],
  /** SYNERGY ARC — drop WEIGHTING (decision D). The powerup roll is no longer
   *  uniform: each kind is picked in proportion to its weight. Stat-tracks (melee,
   *  ranged, pierce, knockback, extraCharge, fasterRecharge, dashStrike) use
   *  trackWeight; on-hit EFFECT axes (lifesteal, + future burn/chain/crit) use the
   *  smaller effectWeight, so effects are UNCOMMON / build-defining rather than
   *  common stat top-ups. ORTHOGONAL to powerupAcceptByLevel: weight = how often a
   *  KIND is picked; acceptance = whether a top-up at the current level spawns.
   *  By-feel — re-tune as more effects join the pool. */
  trackWeight: 1,
  effectWeight: 0.4,
  /** HP a health pickup restores (capped at max). */
  healAmount: 30,
  /** Knockback impulse a KNOCKBACK-melee hit applies (world units/sec). Much
   *  stronger than the base MELEE.knockback shove so the upgraded swing reads as
   *  a launcher — the behaviour change is felt, not a subtle stat nudge. (Now the
   *  tier-I force in KNOCKBACK_LEVELS — kept here for back-reference.) */
  meleeKnockback: 18,
} as const;

// ============================================================================
// ESCALATING POWERUPS (Phase 9). Each weapon stat has LEVELS 0..3 (cap III). LEVEL
// 0 IS THE NO-POWERUP BASE — an un-upgraded run is byte-identical to before. Each
// array is indexed by level (length 4). Per the no-magic-numbers rule, melee
// damage scales as a MULTIPLIER over TUNING.meleeDamage so the ?debug slider still
// drives the base at every level; ranged keeps TUNING.rangedDamage per shot and
// escalates the COUNT instead.
// ============================================================================
/** MELEE level → damage multiplier (over TUNING.meleeDamage) + reach/arc growth.
 *  Default slider (34) yields 34 / 51 / 68 / 85 damage. Reach + arc only widen at
 *  the cap (III) so the top tier visibly swings bigger, not just harder. */
export const MELEE_LEVELS = {
  damageMult: [1, 1.5, 2, 2.5],
  /** MELEE.range multiplier per level (cap III reaches further). */
  reachMult: [1, 1, 1, 1.18],
  /** MELEE.halfArc multiplier per level (cap III sweeps wider). */
  arcMult: [1, 1, 1, 1.18],
} as const;

/** RANGED level → number of projectiles per shot (a spread). Level 0 = 1 (single
 *  shot, unchanged); each level adds one. Damage stays TUNING.rangedDamage/shot —
 *  the COUNT is the escalation (crowd DPS + pierce synergy). */
export const RANGED_LEVELS = {
  shots: [1, 2, 3, 4],
  /** Total fan angle (radians) the shots spread across; 1 shot ignores it. */
  spreadAngle: 0.35,
} as const;

/** PIERCE level → MAX DISTINCT ENEMIES a bolt damages before it despawns. Level 0
 *  = 1 (first-hit-stops, no pierce — unchanged); I = 2, II = 3, III = Infinity
 *  (the pre-Phase-9 infinite pass-through, now the cap). The reframing of "more
 *  pierce" as a counted resource IS the escalation axis (pass-through was maxed). */
export const PIERCE_LEVELS = {
  maxHits: [1, 2, 3, Infinity],
} as const;

/** KNOCKBACK level → melee shove force (world units/sec). Level 0 = MELEE.knockback
 *  (base, unchanged); I = the old powerup force (DROP.meleeKnockback), II/III grow.
 *  PR1 scales FORCE only — stun (II) + AoE (III) land in PR2 on top of these. */
export const KNOCKBACK_LEVELS = {
  force: [MELEE.knockback, DROP.meleeKnockback, 26, 34],
  /** PR2: STUN duration (seconds) applied on a melee knockback hit at level >= 2.
   *  Flat for II + III (III's extra is the AoE, not a longer stun). Long enough to
   *  open space / make the enemy miss a beat, short enough not to perma-lock.
   *  By-feel. Bosses are stun-immune (never set). */
  stunDuration: 0.25,
  /** PR2: level-III AoE radius (world units) from the player centre — a shockwave
   *  slightly wider than the swing (MELEE.range 1.7) that shoves + stuns ALL
   *  in-range enemies (out-of-arc ones take NO damage — crowd-control). By-feel. */
  aoeRadius: 2.5,
} as const;

/** Hard cap on every powerup level (tier III). applyPickup clamps to this. */
export const POWERUP_MAX_LEVEL = 3;

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
  /** Particles emitted on a CRIT hit (synergy arc PR4) — a bigger burst (≈2× the
   *  normal hit) so a crit READS as a crit, not just more damage. */
  critCount: 16,
  /** Particles emitted on enemy death. */
  deathCount: 16,
  /** "Whiff" sparks emitted when a dash dodges a hit (the dodge burst). */
  dodgeCount: 12,
} as const;

/** CHAIN-arc bolt render (synergy arc PR3). Cosmetic-in-sim like particles: the sim
 *  spawns an arc segment (endpoints + a timer), the renderer draws + fades a line. */
export const CHAIN_ARC = {
  /** How long an arc bolt stays visible, seconds (a brief flash). */
  lifetime: 0.18,
  /** Y height the line is drawn at (world units), so it reads above the floor. */
  height: 0.6,
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
  /** Stunned-enemy "dazed" sway: rotation.z amplitude (radians) + rate (per-ms for
   *  performance.now()). Render-only feel for the Phase 9 PR2 stun tell. */
  stunSwayAmp: 0.22,
  stunSwayRate: 0.018,
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
  /** Boss-add silhouette (Phase 8, gimmick #2) — SMALL + spindly with a big head:
   *  a frail summoned thing. Reads as the weak, glowing minion (ember palette),
   *  distinct from the squat chaser / tall ranged / low swarmer. */
  bossadd: {
    bodyRadiusTop: 0.16,
    bodyRadiusBottom: 0.22,
    bodyHeight: 0.6,
    headRadius: 0.22,
    visorSize: 0.16,
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
  /** Min room side (tiles) for a room to qualify as the BOSS room — it must hold
   *  the big boss (radius ~1.4) with play room under the room-rect clamp. With
   *  minRoom 6 every room qualifies; this is a defensive fit-filter for future
   *  bigger bosses / smaller rooms (then the farthest-LARGEST fitting room wins). */
  bossMinRoomSide: 5,
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
    /** BOSS room while the boss LIVES (warm crimson — "the climax / destination",
     *  boss-family). Distinct from the amber active tint + the transient accent-red
     *  current-room highlight, and bolder so the destination reads persistent. Once
     *  the boss dies the stairs pin here (#50) and stairsRoom takes over — an
     *  automatic boss-red -> violet handoff (see Minimap.draw). */
    bossRoom: 'rgba(200, 40, 55, 0.5)',
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
  /** Extra time (seconds) past the end of a gain envelope before stopping the
   *  voice node — lets exponentialRamp reach its target so there's no click. */
  voiceStopPad: 0.02,

  /** Player ACTION blips — bright square/triangle, short envelope. */
  blip: {
    /** Attack + decay envelope, seconds. */
    attack: 0.005,
    decay: 0.09,
    /** Per-event base frequency (Hz) + waveform. An optional `cutoff` adds a
     *  low-pass to that voice, shaving harsh upper harmonics. */
    // SHOOT: dropped from 660 (shrill ice-pick) to a punchy mid-low laser that
    // sits BELOW the melee swing (420) so it doesn't pierce. Stays SQUARE for an
    // electronic "ranged" character (distinct from the triangle melee), with a
    // low-pass to tame the square's shrill 5th+ harmonics, and a touch quieter —
    // ranged fires fast, so less prominent = less repetition fatigue. Pitch
    // jitter still applies, so rapid fire doesn't machine-gun identically.
    shoot: { freq: 360, type: 'square' as OscillatorType, gain: 0.18, cutoff: 1600 },
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

// ============================================================================
// BOSS (Phase 8) — bespoke two-phase boss. Per-attack timings live in ENEMY_TYPES
// .boss (the baseline slam); this block holds the GIMMICK + phase-2 amplification
// + framework knobs. Gimmicks #2 (adds) and #3 (knockback-interrupt) will slot in
// as future attack-table entries — only #1 (positioning) exists now.
// ============================================================================
export const BOSS = {
  /** DEPTH-1 carve-out (gentle INTRO fight). The depth-1 boss is the single-phase
   *  gimmick-1 teach, so it uses these flat overrides instead of the depth curve
   *  (base × mult). Depth >= 2 is untouched: it keeps ENEMY_TYPES.boss.maxHealth /
   *  attackDamage × the 7c mults (see bossHpForDepth / bossDamageForDepth). Both
   *  by-feel — tuned on replay. */
  depth1Health: 140, // vs the would-be 220 at depth 1 — less of a slog
  depth1Damage: 12, // vs the would-be 20 at depth 1 — less lethal
  /** GIMMICK #1 — directional shield. Damage only counts when the hit comes from
   *  within this arc (radians, full width) centred on the VULNERABLE angle; hits
   *  from outside are blocked. ~120° vulnerable wedge — generous but you must get
   *  behind it. */
  vulnerableArc: (2 * Math.PI) / 3,
  /** The vulnerable angle rotates at this rate (radians/sec) so the player must
   *  keep repositioning (tests dash + positioning). */
  vulnerableRotateRate: 0.7,
  /** Phase-2 rotates the weak-point faster (escalation). */
  vulnerableRotatePhase2Mult: 1.6,
  /** Damage multiplier for a blocked (armored-side) hit — 0 = fully negated. The
   *  blocked hit still flashes the shield colour so the tell reads. */
  blockedDamageMult: 0,

  /** PHASE 2 amplification (at <= 50% HP, depth >= bossTwoPhaseMinDepth): the SAME
   *  slam, escalated — NOT new moves. */
  phase2: {
    /** Telegraph shrinks (faster wind-up) — still readable, just tighter. */
    telegraphMult: 0.7,
    /** Slam reach grows (bigger AoE). */
    reachMult: 1.3,
  },

  /** GIMMICK #2 — SUMMON ADDS. A phase-2-only attack-table entry (so single-phase
   *  bosses never summon) that spawns a FINITE, telegraphed wave of weak adds in a
   *  LINE on the player->boss axis (pierce reward). GATED: it no-ops while a wave
   *  is still alive, so there's never more than one wave and no instant respawn —
   *  pressure, not a grind. Killing the boss despawns the wave (the fight ends).
   *  Adds are tuned in ENEMY_TYPES.bossadd; these are the summon's count/cadence/
   *  geometry. */
  summon: {
    /** Adds per wave (finite). boss(1) + count must stay <= POOL.enemies (8). */
    count: 3,
    /** Wind-up before the adds appear, seconds (reuses the boss telegraph render). */
    telegraph: 0.8,
    /** Strike window (the adds spawn on the first strike frame), seconds. */
    strike: 0.2,
    /** Recovery after summoning before the next attack, seconds. */
    recover: 0.7,
    /** Spacing between adds along the spawn line, world units (a column a single
     *  pierce shot can skewer). */
    lineSpacing: 0.9,
    /** Distance from the boss centre to the wave's near end, world units (just
     *  outside the boss body so adds don't spawn inside it). */
    lineOffset: 1.8,
  },

  /** GIMMICK #3 — CLEAVE: the signature heavy strike of the knockback-interrupt
   *  boss. A LONGER, clearly-telegraphed wind-up (the interrupt WINDOW) hitting a
   *  bigger AoE for more damage than the slam — the "punish the big windup" attack.
   *  A weak-side knockback-track hit during the telegraph CANCELS it (see
   *  BOSS.interrupt). DODGEABLE like the slam if you can't / don't interrupt. All
   *  by-feel — tune on playtest (the telegraph length IS the interrupt window). */
  cleave: {
    /** Wind-up before the cleave lands, seconds — longer than the slam's 0.9 so the
     *  tell (and the interrupt opportunity) is unmistakable. Phase 2 shrinks it via
     *  phase2.telegraphMult (tighter window, no new knob). */
    telegraph: 1.3,
    /** Active strike window, seconds (matches the slam). */
    strike: 0.2,
    /** Recovery after the cleave before the next attack, seconds. */
    recover: 0.9,
    /** Reach multiplier on the slam's (attackReach + radius) — a bigger AoE so the
     *  heavy attack feels heavy (still dash-dodgeable). */
    reachMult: 1.25,
    /** Damage multiplier on the depth-scaled boss attackDamage — hits harder than
     *  the slam (the cost of eating a windup you could have read). */
    damageMult: 1.5,
  },

  /** GIMMICK #3 — INTERRUPT reward. A successful cancel drops the boss into a
   *  SHIELD-DOWN stagger: for this long (seconds) the vulnerable-arc check is
   *  bypassed, so hits land from ANY angle — the free-hit payoff for reading the
   *  tell. By-feel (rewarding but not a stun-lock). */
  interrupt: {
    staggerDuration: 1.2,
  },
} as const;

/** BOSS render tuning (Phase 8) — the bespoke single boss mesh (rendering layer
 *  only; the pure sim reads ENEMY_TYPES.boss + BOSS). Dimensions are world units;
 *  the body radius comes from ENEMY_TYPES.boss.radius so the silhouette matches
 *  the collision/clamp footprint. */
export const BOSS_VFX = {
  /** Body cylinder height (tall, looming). */
  bodyHeight: 1.8,
  /** RENDER-ONLY scale on the body cylinder radius (visual width only) — decouples
   *  the silhouette from the 1.4 gameplay radius (the hitbox / #37 clamp / slam
   *  reach), which is deliberately left untouched. The weak-point orbit uses the
   *  same scale so the marker stays on the slimmed body surface. */
  bodyRadiusScale: 0.85,
  /** Head sphere radius. */
  headRadius: 0.4,
  /** Bright weak-point marker size (the box that orbits to the vulnerable side). */
  weakPointSize: 0.55,
  /** Height (y) of the orbiting weak-point marker. */
  weakPointHeight: 1.2,
  /** Floor ring radius around the base (reads "arena boss"). */
  ringRadius: 1.3,
  /** Floor ring tube thickness. */
  ringTube: 0.12,
  /** Body emissive intensity. */
  emissive: 0.55,
  /** Extra scale at the peak of a slam telegraph (grows then strikes). */
  telegraphScale: 0.22,
  /** Weak-point marker pulse amplitude (0 = no pulse, 0.15 = ±15% scale). */
  weakPointPulseAmp: 0.15,
  /** Weak-point marker pulse rate (per-ms frequency for performance.now()). */
  weakPointPulseRate: 0.006,
} as const;
