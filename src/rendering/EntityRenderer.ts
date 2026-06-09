/**
 * Renders all dynamic entities — player + enemies as procedural humanoid FIGURES
 * (CylinderGeometry body + SphereGeometry head + a front visor "eye" indicator),
 * plus projectiles, hit-sparks, the melee swing and the dash trail.
 *
 * Everything is POOLED exactly as the placeholder cubes were: a fixed set of
 * meshes/groups created ONCE in the constructor and only shown/hidden, moved,
 * rotated, scaled and recoloured each frame from the (read-only) game state.
 * Nothing allocates geometry or materials per frame. Positions INTERPOLATE
 * between each entity's previous and current sim-step position by the frame
 * `alpha`. This layer never mutates game state.
 *
 * FACING (the iso trap — a bare cylinder looks the same from many angles):
 *  - Player figure faces the AIM vector (the exact vector the ranged/aim system
 *    uses — resolved here via the pure `aimDirection`, no sim state added).
 *  - Enemy figure faces the player (its chase/telegraph/strike target).
 *  - A bright front visor makes the facing unambiguous from the iso camera.
 *
 * Game (x, y) maps to three (x, z); the floor is y = 0.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
} from 'three';
import type { GameState } from '../game/GameState';
import { aimDirection } from '../game/Combat';
import type { InputIntent } from '../game/Input';
import type { PickupKind } from '../game/Pickup';
import {
  BARRIER,
  BLOB,
  BOSS_VFX,
  CHAIN_ARC,
  CHEST,
  CHEST_CHOICE,
  ENEMY_COMMON,
  ENEMY_PROJ,
  ENEMY_TYPES,
  FIGURE,
  KILL,
  MELEE,
  PALETTE,
  PICKUP,
  POOL,
  RANGED,
  ROOM,
  STAIRS,
  TOAST,
  VFX,
  type EnemyType,
} from '../utils/constants';
import { lerp, type Vec2 } from '../utils/math';

/** Per-enemy-type render presentation: silhouette dims + body colour. Adding a
 *  type = one entry here (mirrors the ENEMY_TYPES sim table). */
const ENEMY_FIGURE: Record<EnemyType, FigureDims> = {
  chaser: FIGURE.chaser,
  armored: FIGURE.armored,
  ranged: FIGURE.ranged,
  swarmer: FIGURE.swarmer,
  // The boss is a BESPOKE single mesh (see makeBoss / syncBoss), NOT a pooled
  // figure — this entry only satisfies the Record<EnemyType> type; it's never
  // built (boss is excluded from ENEMY_KINDS).
  boss: FIGURE.chaser,
  bossadd: FIGURE.bossadd,
};
const ENEMY_BODY_COLOR: Record<EnemyType, number> = {
  chaser: PALETTE.enemy,
  armored: PALETTE.enemyArmored,
  ranged: PALETTE.enemyRanged,
  swarmer: PALETTE.enemySwarmer,
  boss: PALETTE.enemyBoss,
  bossadd: PALETTE.enemyBossAdd,
};
/** Pooled figure kinds — the boss is excluded (bespoke single mesh, not pooled);
 *  the boss-add (gimmick #2) IS pooled like the base enemies. */
const ENEMY_KINDS: EnemyType[] = ['chaser', 'armored', 'ranged', 'swarmer', 'bossadd'];

/** Death-POP scale from the remaining pop timer (juice PR-1). A fast UP-phase to
 *  1+overshoot, then an eased (accelerating) collapse to 0 — the enemy "pops" out
 *  of existence. Pure: timer in [0, KILL.popDuration] → scale, no state. */
function killPopScale(timerRemaining: number): number {
  const t = 1 - timerRemaining / KILL.popDuration; // 0 at death → 1 at end
  if (t < KILL.popUpFrac) return 1 + KILL.popOvershoot * (t / KILL.popUpFrac);
  const u = (t - KILL.popUpFrac) / (1 - KILL.popUpFrac);
  return (1 + KILL.popOvershoot) * (1 - u * u); // → 0
}

/** 0xRRGGBB -> '#rrggbb' for canvas drawing (reuses PALETTE, no new colours). */
const cssHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A small square icon texture drawn once (per-kind glyph: cross / arrow / burst). */
function iconTexture(draw: (g: CanvasRenderingContext2D, s: number) => void): CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const g = c.getContext('2d');
  if (g) draw(g, s);
  const t = new CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/** A wide text-pill texture for the on-collect toast. Returns texture + aspect. */
function textTexture(text: string, color: string): { tex: CanvasTexture; aspect: number } {
  const w = 256;
  const h = 64;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.roundRect(2, 8, w - 4, h - 16, 18);
    g.fill();
    g.font = 'bold 34px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  }
  const tex = new CanvasTexture(c);
  tex.needsUpdate = true;
  return { tex, aspect: w / h };
}

/** A thick ＋ cross filling the icon canvas (health). */
function drawCross(g: CanvasRenderingContext2D, s: number, color: string): void {
  const t = s * 0.26; // arm thickness
  const m = s * 0.16; // margin
  g.fillStyle = color;
  g.fillRect(s / 2 - t / 2, m, t, s - 2 * m); // vertical
  g.fillRect(m, s / 2 - t / 2, s - 2 * m, t); // horizontal
}

/** LIFESTEAL (synergy arc): a heart — two top lobes + a point (heal-on-hit). */
function drawHeart(g: CanvasRenderingContext2D, s: number, color: string): void {
  const m = s * 0.18;
  const w = s - 2 * m;
  const top = m + w * 0.3; // y of the lobe centres
  const r = w * 0.25; // lobe radius
  g.fillStyle = color;
  g.beginPath();
  g.arc(m + r, top, r, Math.PI, 0); // left lobe
  g.arc(s - m - r, top, r, Math.PI, 0); // right lobe
  g.lineTo(s / 2, s - m); // down to the point
  g.closePath();
  g.fill();
}

/** BURN (synergy arc): a flame — a teardrop tip over a rounded base (DoT/on fire). */
function drawFlame(g: CanvasRenderingContext2D, s: number, color: string): void {
  const m = s * 0.2;
  const cx = s / 2;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(cx, m); // top tip
  g.quadraticCurveTo(s - m, s * 0.5, cx, s - m); // right side down to the base
  g.quadraticCurveTo(m, s * 0.5, cx, m); // left side back to the tip
  g.closePath();
  g.fill();
}

/** CHAIN (synergy arc): a lightning bolt — a zig-zag stroke (arc-to-nearby). */
function drawChain(g: CanvasRenderingContext2D, s: number, color: string): void {
  const m = s * 0.2;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, s * 0.12);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(s * 0.62, m);
  g.lineTo(s * 0.4, s * 0.5);
  g.lineTo(s * 0.58, s * 0.5);
  g.lineTo(s * 0.36, s - m);
  g.stroke();
}

/** CRIT (synergy arc finale): a 4-point sparkle star — the "jackpot" crit hit. */
function drawStar(g: CanvasRenderingContext2D, s: number, color: string): void {
  const cx = s / 2;
  const cy = s / 2;
  const o = s * 0.42; // outer radius
  const i = s * 0.15; // inner waist
  g.fillStyle = color;
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 - Math.PI / 2;
    const r = k % 2 === 0 ? o : i;
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fill();
}

/** FREEZE (meta PR1): a 6-spoke snowflake — the icy slow effect. */
function drawSnowflake(g: CanvasRenderingContext2D, s: number, color: string): void {
  const cx = s / 2;
  const cy = s / 2;
  const r = s * 0.4;
  g.strokeStyle = color;
  g.lineWidth = Math.max(1, s * 0.1);
  g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * Math.PI * 2;
    const ex = cx + Math.cos(ang) * r;
    const ey = cy + Math.sin(ang) * r;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(ex, ey);
    g.stroke();
    // little barbs near the tip
    const bx = cx + Math.cos(ang) * r * 0.6;
    const by = cy + Math.sin(ang) * r * 0.6;
    for (const da of [-0.5, 0.5]) {
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + Math.cos(ang + da) * r * 0.25, by + Math.sin(ang + da) * r * 0.25);
      g.stroke();
    }
  }
}

/** A right-pointing arrow filling the icon canvas (PIERCE — shots pass THROUGH).
 *  Long shaft + head reads as penetration, distinct from the burst silhouette. */
function drawArrow(g: CanvasRenderingContext2D, s: number, color: string): void {
  const cy = s / 2;
  const th = s * 0.16; // shaft thickness
  g.fillStyle = color;
  g.fillRect(s * 0.1, cy - th / 2, s * 0.5, th); // shaft
  g.beginPath(); // head
  g.moveTo(s * 0.54, cy - s * 0.26);
  g.lineTo(s * 0.92, cy);
  g.lineTo(s * 0.54, cy + s * 0.26);
  g.closePath();
  g.fill();
}

/** A radiating burst filling the icon canvas (KNOCKBACK — melee launches enemies
 *  outward). Eight spokes read as an outward shove, distinct from the arrow. */
function drawBurst(g: CanvasRenderingContext2D, s: number, color: string): void {
  const c = s / 2;
  const inner = s * 0.1;
  const outer = s * 0.42;
  g.strokeStyle = color;
  g.lineWidth = s * 0.11;
  g.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
    g.lineTo(c + Math.cos(a) * outer, c + Math.sin(a) * outer);
    g.stroke();
  }
}

/** A double right-chevron (EXTRA-CHARGE — a second dash / "more dashes"). Two
 *  stacked chevrons read as "+1", distinct from the single pierce arrow. */
function drawDoubleChevron(g: CanvasRenderingContext2D, s: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = s * 0.14;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const ox of [s * 0.28, s * 0.52]) {
    g.beginPath();
    g.moveTo(ox, s * 0.24);
    g.lineTo(ox + s * 0.2, s * 0.5);
    g.lineTo(ox, s * 0.76);
    g.stroke();
  }
}

/** A circular recharge arrow (FASTER-RECHARGE — charges refill quicker). A near-
 *  full ring with an arrowhead reads as "cycle/refill", distinct from the burst. */
function drawRecharge(g: CanvasRenderingContext2D, s: number, color: string): void {
  const c = s / 2;
  const r = s * 0.3;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = s * 0.12;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(c, c, r, -Math.PI * 0.35, Math.PI * 1.35); // open ring (gap top-right)
  g.stroke();
  // Arrowhead at the ring's open (top) end.
  const ax = c + Math.cos(-Math.PI * 0.35) * r;
  const ay = c + Math.sin(-Math.PI * 0.35) * r;
  const h = s * 0.16;
  g.beginPath();
  g.moveTo(ax + h, ay);
  g.lineTo(ax - h * 0.4, ay - h);
  g.lineTo(ax - h * 0.4, ay + h);
  g.closePath();
  g.fill();
}

/** A diagonal blade with trailing speed-lines (DASH-STRIKE — a dash that cuts
 *  through enemies). The slash + motion lines read as "attack on the move",
 *  distinct from the extra-charge chevrons and the faster-recharge ring. */
function drawBladeDash(g: CanvasRenderingContext2D, s: number, color: string): void {
  g.strokeStyle = color;
  g.lineCap = 'round';
  // The blade: a thick slash from lower-left to upper-right.
  g.lineWidth = s * 0.16;
  g.beginPath();
  g.moveTo(s * 0.26, s * 0.74);
  g.lineTo(s * 0.74, s * 0.26);
  g.stroke();
  // Two trailing speed-lines behind it (lower-left), thinner.
  g.lineWidth = s * 0.08;
  for (const o of [s * 0.12, s * 0.24]) {
    g.beginPath();
    g.moveTo(s * 0.14, s * 0.62 + o * 0.0);
    g.lineTo(s * 0.14 + o, s * 0.62 - o);
    g.stroke();
  }
}

/** An upright blade with a crossguard (MELEE level — the swing gets stronger).
 *  A sword silhouette reads as the melee weapon, distinct from the dash-strike
 *  diagonal slash and the knockback burst. */
function drawSword(g: CanvasRenderingContext2D, s: number, color: string): void {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineWidth = s * 0.13;
  g.beginPath(); // blade
  g.moveTo(s * 0.5, s * 0.16);
  g.lineTo(s * 0.5, s * 0.7);
  g.stroke();
  g.beginPath(); // crossguard
  g.moveTo(s * 0.34, s * 0.66);
  g.lineTo(s * 0.66, s * 0.66);
  g.stroke();
  g.beginPath(); // pommel
  g.moveTo(s * 0.5, s * 0.7);
  g.lineTo(s * 0.5, s * 0.84);
  g.stroke();
}

/** Three stacked right-arrows (RANGED level — multishot spread). The fan of
 *  arrows reads as "more shots", distinct from the single pierce arrow. */
function drawMultishot(g: CanvasRenderingContext2D, s: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = s * 0.1;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const cy of [s * 0.28, s * 0.5, s * 0.72]) {
    g.beginPath(); // a short right-pointing arrow
    g.moveTo(s * 0.2, cy);
    g.lineTo(s * 0.66, cy);
    g.moveTo(s * 0.52, cy - s * 0.1);
    g.lineTo(s * 0.66, cy);
    g.lineTo(s * 0.52, cy + s * 0.1);
    g.stroke();
  }
}

/** FIRE-RATE (meta PR2): staggered horizontal speed-streaks → reads "rapid / faster",
 *  distinct from the multishot arrows + the dash chevrons. */
function drawFireRate(g: CanvasRenderingContext2D, s: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = s * 0.12;
  g.lineCap = 'round';
  const streaks: [number, number, number][] = [
    [0.46, 0.3, 0.84], // [x0, cy(frac), x1] — top streak, shorter
    [0.2, 0.5, 0.84], // middle, longest
    [0.38, 0.7, 0.84], // bottom, medium
  ];
  for (const [x0, cyf, x1] of streaks) {
    g.beginPath();
    g.moveTo(s * x0, s * cyf);
    g.lineTo(s * x1, s * cyf);
    g.stroke();
  }
}

/** Per-drop-kind presentation: VERB/system colour + glyph + toast label. The
 *  verb powerups borrow their verb colour (pierce = ranged blue, knockback =
 *  melee orange); the three DASH powerups share the dash magenta and differ by
 *  glyph; health keeps its own green. */
const DROP_COLOR: Record<PickupKind, number> = {
  health: PALETTE.pickupHealth,
  melee: PALETTE.melee,
  ranged: PALETTE.projectile,
  pierce: PALETTE.projectile,
  knockback: PALETTE.melee,
  extraCharge: PALETTE.dash,
  fasterRecharge: PALETTE.dash,
  dashStrike: PALETTE.dash,
  lifesteal: PALETTE.lifesteal,
  burn: PALETTE.enemyBurning,
  chain: PALETTE.chainArc,
  crit: PALETTE.crit,
  freeze: PALETTE.enemyFrozen,
  fireRate: PALETTE.fireRate,
};
const DROP_GLYPH: Record<PickupKind, (g: CanvasRenderingContext2D, s: number, color: string) => void> = {
  health: drawCross,
  melee: drawSword,
  ranged: drawMultishot,
  pierce: drawArrow,
  knockback: drawBurst,
  extraCharge: drawDoubleChevron,
  fasterRecharge: drawRecharge,
  dashStrike: drawBladeDash,
  lifesteal: drawHeart,
  burn: drawFlame,
  chain: drawChain,
  crit: drawStar,
  freeze: drawSnowflake,
  fireRate: drawFireRate,
};
const DROP_LABEL: Record<PickupKind, string> = {
  health: '+HP',
  melee: 'MELEE',
  ranged: 'RANGED',
  pierce: 'PIERCE',
  knockback: 'KNOCKBACK',
  extraCharge: 'EXTRA DASH',
  fasterRecharge: 'FAST DASH',
  dashStrike: 'DASH STRIKE',
  lifesteal: 'LIFESTEAL',
  burn: 'BURN',
  chain: 'CHAIN',
  crit: 'CRIT',
  freeze: 'FREEZE',
  fireRate: 'FIRE RATE',
};
const DROP_KINDS: PickupKind[] = [
  'health',
  'melee',
  'ranged',
  'pierce',
  'knockback',
  'extraCharge',
  'fasterRecharge',
  'dashStrike',
  'lifesteal',
  'burn',
  'chain',
  'crit',
  'freeze',
  'fireRate',
];

/** Geometry + child Y offsets for one figure type (shared across a pool). */
interface FigureGeos {
  body: CylinderGeometry;
  head: SphereGeometry;
  visor: BoxGeometry;
  bodyCenterY: number;
  headCenterY: number;
  visorX: number;
  visorY: number;
}

/** One built figure: an outer group (position/facing/scale) wrapping an inner
 *  group (tilt/lean), plus the body+head material for state recolouring. */
interface Figure {
  group: Group;
  inner: Group;
  bodyMat: MeshStandardMaterial;
}

/** Structural dimensions for one figure type (player and enemy both satisfy it;
 *  a `typeof FIGURE.player` would bind to that variant's literal numbers). */
interface FigureDims {
  bodyRadiusTop: number;
  bodyRadiusBottom: number;
  bodyHeight: number;
  headRadius: number;
  visorSize: number;
}

export class EntityRenderer {
  private readonly player: Figure;
  private readonly playerBodyCenterY: number;
  private playerLean = 0;
  private lastNow = 0;

  /** Fake blob shadows (lighting PR-B) — flat soft discs under floating entities
   *  for grounding. Pooled in parallel with each entity pool; share ONE radial-
   *  alpha texture + ONE CircleGeometry (built in initBlobShadows). Cosmetic:
   *  positioned from the rendered location each frame, never read by the sim. */
  private blobGeo!: CircleGeometry;
  private playerBlob!: Mesh;
  private readonly enemyBlobs: Mesh[] = [];
  private bossBlob!: Mesh;
  private readonly pickupBlobs: Mesh[] = [];

  /** One figure pool PER enemy type (slot i mirrors enemy-pool slot i); the
   *  matching-type figure is shown, the other-type figure at i is hidden. */
  private readonly enemyFigs: Record<EnemyType, Figure[]> = { chaser: [], armored: [], ranged: [], swarmer: [], boss: [], bossadd: [] };
  /** Bespoke single boss mesh (Phase 8): a large armored body + head, an orbiting
   *  bright WEAK-POINT marker (gimmick #1 tell) and a floor ring. Not pooled. */
  private readonly bossGroup: Group;
  private readonly bossInner: Group;
  private readonly bossBodyMat: MeshStandardMaterial;
  private readonly bossWeak: Mesh;
  private readonly bossWeakMat: MeshStandardMaterial;
  private readonly bossWeakOrbit: number;
  /** Telegraph-tell tracking: the active attack's FULL telegraph duration, captured
   *  on entry so the wind-up scale ramp is correct for any attack (slam vs the
   *  longer cleave) AND phase 2's shortened wind-up. e.timer is monotonic, so its
   *  first value on entering 'telegraph' IS the max; reset when the phase leaves. */
  private bossPrevPhase = '';
  private bossTeleMax = 0;
  private readonly projectiles: Mesh[] = [];
  /** Ranged-enemy bolts (scarlet spheres) — own pool, distinct from player shots. */
  private readonly enemyProjectiles: Mesh[] = [];
  private readonly particles: Mesh[] = [];
  /** Chain-arc bolts (synergy arc PR3) — pooled 2-point lines, one per ChainArc slot;
   *  each has its own material so it can fade independently. */
  private readonly chainArcs: Line[] = [];
  /** Golden chests (PR-B) — pooled 3D chests (base + hinged lid + trim + clasp). The
   *  group bobs/sways/glows while closed; on open (frame-diffed) the lid flings open. */
  private readonly chests: Group[] = [];
  /** Per-chest lid PIVOT groups (rotate to fling the lid open). */
  private readonly chestLids: Group[] = [];
  /** Shared gold material (its emissive pulses globally for the idle glow). */
  private chestGoldMat!: MeshStandardMaterial;
  /** Frame-diff state for the open animation (render-only — the sim has no timer):
   *  previous `opened` flag + the wall-clock ms the open began (-1 = not opening). */
  private readonly chestPrevOpened: boolean[] = [];
  private readonly chestOpenStart: number[] = [];
  /** Accessibility reduce-motion (set by main.ts from Settings, like HUD): stills the
   *  chest idle bob/sway/glow-pulse AND the death POP (the pop is motion; the colored
   *  death burst, being information, is kept). Discrete reveals stay. */
  private reduceMotion = false;
  /** Death POP (juice PR-1): per enemy-slot render state. `enemyPrevActive` frame-
   *  diffs active→false to start a pop; `enemyDyingTimer` counts the pop down so the
   *  dead figure scale-overshoots-then-vanishes before it's hidden. Render-only. */
  private readonly enemyPrevActive: boolean[] = [];
  private readonly enemyDyingTimer: number[] = [];
  /** Death-burst tint → shared material cache (built lazily, ≤ a handful of colors,
   *  one-time each — NO per-particle/per-frame allocation). Key 0 = the white spark. */
  private readonly particleMats = new Map<number, MeshBasicMaterial>();
  private readonly trail: Mesh[] = [];
  private readonly trailX: number[] = [];
  private readonly trailY: number[] = [];
  private readonly meleeGroup: Group;
  private readonly meleeMat: MeshBasicMaterial;
  private readonly pickups: Mesh[] = [];
  private readonly pickupMats: MeshStandardMaterial[] = [];
  private readonly barriers: Mesh[] = [];
  /** Descent stairs — a single per-floor entity (ring + billboarded glyph),
   *  shown only when the floor is cleared. Not pooled (one exit per floor). */
  private readonly stairsRing: Mesh;
  private readonly stairsLabel: Sprite;
  // Floating type-icons above each pickup (billboarded — always face the camera).
  private readonly pickupIcons: Sprite[] = [];
  /** One shared icon material per drop kind (cross / arrow / burst). */
  private iconMats!: Record<PickupKind, SpriteMaterial>;
  /** Render-side snapshot of pickup liveness, to detect collection (-> toast). */
  private readonly prevPickupActive: boolean[] = [];
  // On-collect toasts ("+HP" / "PIERCE" / "KNOCKBACK") — pooled, per-toast material.
  private readonly toasts: Sprite[] = [];
  private readonly toastLife: number[] = [];
  /** One shared toast texture per drop kind. */
  private toastTex!: Record<PickupKind, CanvasTexture>;
  private toastAspect = 4;
  // CHEST CHOICE legibility (#chest-clarity): per-pair tether LINE + "CHOOSE ONE"
  // billboard, keyed off two active pickups sharing a pairId. Pooled to the max
  // simultaneous pairs (floor(POOL.pickups / 2)). Driven purely by sim state — when
  // the choice resolves the pair is gone and these hide automatically.
  private readonly pairLinks: Line[] = [];
  private readonly pairLabels: Sprite[] = [];
  /** Shared "CHOOSE ONE" label material (one prompt, pulsed together). */
  private pairLabelMat!: SpriteMaterial;

  /** Reused scratch for the resolved aim direction — no per-frame allocation. */
  private readonly aim: Vec2 = { x: 0, y: 0 };

  constructor(scene: Scene) {
    // --- Player figure ---
    const playerGeos = this.makeGeos(FIGURE.player);
    this.playerBodyCenterY = playerGeos.bodyCenterY;
    this.player = this.makeFigure(playerGeos, PALETTE.player, VFX.playerEmissive, PALETTE.invuln);
    scene.add(this.player.group);

    // --- Dash trail: faded ghosts of the player BODY (shared geometry) ---
    for (let i = 0; i < VFX.trailLength; i++) {
      const m = new Mesh(
        playerGeos.body,
        new MeshBasicMaterial({ color: PALETTE.player, transparent: true, opacity: 0 }),
      );
      m.visible = false;
      this.trail.push(m);
      this.trailX.push(0);
      this.trailY.push(0);
      scene.add(m);
    }

    // --- Enemy figures: one pool PER type (shared geometry per type, per-enemy
    // materials). A pool slot has both a chaser-shaped and a ranged-shaped figure;
    // syncEnemies shows whichever matches the enemy in that slot. ---
    for (const kind of ENEMY_KINDS) {
      const geos = this.makeGeos(ENEMY_FIGURE[kind]);
      for (let i = 0; i < POOL.enemies; i++) {
        const fig = this.makeFigure(geos, ENEMY_BODY_COLOR[kind], VFX.enemyEmissive, PALETTE.enemyTelegraph);
        fig.group.visible = false;
        this.enemyFigs[kind].push(fig);
        scene.add(fig.group);
      }
    }
    // Seed per-slot death-pop state (one entry per enemy pool slot).
    for (let i = 0; i < POOL.enemies; i++) {
      this.enemyPrevActive.push(false);
      this.enemyDyingTimer.push(0);
    }

    // --- Projectiles (pooled, shared material) ---
    const projGeo = new BoxGeometry(RANGED.radius * 2, RANGED.radius * 2, RANGED.radius * 2);
    const projMat = new MeshBasicMaterial({ color: PALETTE.projectile });
    for (let i = 0; i < POOL.projectiles; i++) {
      const m = new Mesh(projGeo, projMat);
      m.visible = false;
      this.projectiles.push(m);
      scene.add(m);
    }

    // --- Enemy bolts (pooled, shared material): scarlet SPHERES — a distinct
    // shape from the player's blue cube, so "incoming red ball" never reads as
    // "my shot". ---
    const eProjGeo = new SphereGeometry(ENEMY_PROJ.radius, 10, 10);
    const eProjMat = new MeshBasicMaterial({ color: PALETTE.enemyProjectile });
    for (let i = 0; i < POOL.enemyProjectiles; i++) {
      const m = new Mesh(eProjGeo, eProjMat);
      m.visible = false;
      this.enemyProjectiles.push(m);
      scene.add(m);
    }

    // --- Hit-spark particles (pooled). The default WHITE spark is the tint-0
    // material; death bursts swap to a per-hue material from the lazy cache. ---
    const partGeo = new BoxGeometry(VFX.particleSize, VFX.particleSize, VFX.particleSize);
    const partMat = new MeshBasicMaterial({ color: PALETTE.spark });
    this.particleMats.set(0, partMat); // tint 0 = white spark (hits / dodge / player death)
    for (let i = 0; i < POOL.particles; i++) {
      const m = new Mesh(partGeo, partMat);
      m.visible = false;
      this.particles.push(m);
      scene.add(m);
    }

    // --- Chain-arc bolts (pooled lines; synergy arc PR3). Each is a 2-vertex line
    // with its own transparent material so it fades by life/maxLife independently. ---
    for (let i = 0; i < POOL.chainArcs; i++) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const mat = new LineBasicMaterial({ color: PALETTE.chainArc, transparent: true, opacity: 0 });
      const line = new Line(geo, mat);
      line.visible = false;
      this.chainArcs.push(line);
      scene.add(line);
    }

    // --- CHEST CHOICE legibility: a warm-gold tether LINE + a shared "CHOOSE ONE"
    // billboard per paired set. Pooled to the max concurrent pairs. The line color is
    // chest-gold (NOT the cyan chain bolt) so it never reads as combat. ---
    const pairSlots = Math.floor(POOL.pickups / 2);
    const chooseLabel = textTexture(CHEST_CHOICE.labelText, cssHex(PALETTE.pairLink));
    this.pairLabelMat = new SpriteMaterial({ map: chooseLabel.tex, transparent: true, depthTest: false });
    for (let i = 0; i < pairSlots; i++) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
      const mat = new LineBasicMaterial({ color: PALETTE.pairLink, transparent: true, opacity: CHEST_CHOICE.linkOpacity });
      const line = new Line(geo, mat);
      line.visible = false;
      this.pairLinks.push(line);
      scene.add(line);

      const label = new Sprite(this.pairLabelMat);
      label.scale.set(CHEST_CHOICE.labelSize * chooseLabel.aspect, CHEST_CHOICE.labelSize, 1);
      label.visible = false;
      this.pairLabels.push(label);
      scene.add(label);
    }

    // --- Golden chests (v2): the ICONOGRAPHIC chest — a BASE box + a DOMED lid (a
    // faceted barrel/half-cylinder, the #1 chest cue) + dark-METAL two-tone banding
    // (a seam band + two vertical front straps) + a front LOCK. Gold body with the
    // emissive "treasure" glow (on the gold, not the metal); dark iron-bronze metal
    // for contrast. The domed lid is a cylinder laid on its side inside the hinge
    // PIVOT (back-top edge) so the existing open-fling + mimic-wobble animate it
    // unchanged. Geometries shared across the pool; one Group per chest. ---
    const bs = CHEST.bodySize;
    const baseGeo = new BoxGeometry(bs, CHEST.baseHeight, bs);
    // Domed lid: a cylinder (axis laid along the chest WIDTH via rotation.z) so the top
    // curves — the lower half tucks into the base, the upper half is the visible dome.
    const lidGeo = new CylinderGeometry(CHEST.lidRadius, CHEST.lidRadius, bs, CHEST.lidSegments);
    // Dark-metal detail (shared): seam band, a vertical strap, the lock.
    const seamGeo = new BoxGeometry(bs * 1.06, CHEST.baseHeight * 0.16, bs * 1.06);
    const strapGeo = new BoxGeometry(CHEST.strapWidth, CHEST.baseHeight, CHEST.strapProud);
    const lockGeo = new BoxGeometry(bs * 0.2, CHEST.baseHeight * 0.5, CHEST.strapProud * 1.6);
    this.chestGoldMat = new MeshStandardMaterial({
      color: PALETTE.chest,
      emissive: PALETTE.chest,
      emissiveIntensity: CHEST.emissive,
    });
    const metalMat = new MeshStandardMaterial({
      color: PALETTE.chestMetal,
      emissive: PALETTE.chestMetal,
      emissiveIntensity: CHEST.trimEmissive,
    });
    const frontZ = -bs / 2 - CHEST.strapProud / 2; // proud of the front face (z = -bs/2)
    for (let i = 0; i < POOL.chests; i++) {
      const group = new Group();
      // Gold base box, sitting on the group floor (origin y = 0).
      const base = new Mesh(baseGeo, this.chestGoldMat);
      base.position.y = CHEST.baseHeight / 2;
      // Dark seam band at the lid/base join.
      const seam = new Mesh(seamGeo, metalMat);
      seam.position.y = CHEST.baseHeight;
      // Two vertical straps down the front face.
      const strapL = new Mesh(strapGeo, metalMat);
      strapL.position.set(-CHEST.strapInset, CHEST.baseHeight / 2, frontZ);
      const strapR = new Mesh(strapGeo, metalMat);
      strapR.position.set(CHEST.strapInset, CHEST.baseHeight / 2, frontZ);
      // Front LOCK, centred on the seam — the cue that kills "is it a chest?".
      const lock = new Mesh(lockGeo, metalMat);
      lock.position.set(0, CHEST.baseHeight, -bs / 2 - CHEST.strapProud * 0.8);
      // Hinge pivot at the BACK-top edge; the domed lid sits forward of it (cylinder
      // on its side: rotation.z puts the axis along X = the chest width).
      const lidPivot = new Group();
      lidPivot.position.set(0, CHEST.baseHeight, bs / 2);
      const lid = new Mesh(lidGeo, this.chestGoldMat);
      lid.rotation.z = Math.PI / 2;
      lid.position.set(0, 0, -bs / 2);
      lidPivot.add(lid);
      group.add(base, seam, strapL, strapR, lock, lidPivot);
      group.visible = false;
      this.chests.push(group);
      this.chestLids.push(lidPivot);
      this.chestPrevOpened.push(false);
      this.chestOpenStart.push(-1);
      scene.add(group);
    }

    // --- Melee swing (flat sector, oriented via a parent group) ---
    // Uses the dedicated melee verb colour (no longer aliases the player body).
    this.meleeMat = new MeshBasicMaterial({ color: PALETTE.melee, transparent: true, opacity: 0 });
    const sector = new Mesh(
      new CircleGeometry(MELEE.range, 18, -MELEE.halfArc, MELEE.halfArc * 2),
      this.meleeMat,
    );
    sector.rotation.x = -Math.PI / 2; // lay flat on the floor
    this.meleeGroup = new Group();
    this.meleeGroup.add(sector);
    this.meleeGroup.visible = false;
    scene.add(this.meleeGroup);

    // --- Pickups (pooled; per-pickup material so health/buff can recolour) ---
    const pickGeo = new BoxGeometry(PICKUP.size, PICKUP.size, PICKUP.size);
    for (let i = 0; i < POOL.pickups; i++) {
      const mat = new MeshStandardMaterial({
        color: PALETTE.pickupHealth,
        emissive: PALETTE.pickupHealth,
        emissiveIntensity: VFX.pickupEmissive,
        roughness: 0.4,
      });
      const m = new Mesh(pickGeo, mat);
      m.visible = false;
      this.pickups.push(m);
      this.pickupMats.push(mat);
      scene.add(m);
    }

    // --- Pickup type-icons: a billboard glyph per kind (cross = health, arrow =
    // pierce, burst = knockback) so the drop's MEANING reads at a glance, not
    // just its colour. One shared material per kind; one pooled sprite per slot. ---
    this.iconMats = {} as Record<PickupKind, SpriteMaterial>;
    for (const kind of DROP_KINDS) {
      const mat = new SpriteMaterial({ transparent: true });
      mat.map = iconTexture((g, s) => DROP_GLYPH[kind](g, s, cssHex(DROP_COLOR[kind])));
      this.iconMats[kind] = mat;
    }
    for (let i = 0; i < POOL.pickups; i++) {
      const sp = new Sprite(this.iconMats.health);
      sp.scale.set(PICKUP.iconSize, PICKUP.iconSize, 1);
      sp.visible = false;
      this.pickupIcons.push(sp);
      this.prevPickupActive.push(false);
      scene.add(sp);
    }

    // --- On-collect toasts (pooled; each its own material so they fade
    // independently). One shared texture per kind, swapped onto a toast on fire. ---
    this.toastTex = {} as Record<PickupKind, CanvasTexture>;
    for (const kind of DROP_KINDS) {
      const t = textTexture(DROP_LABEL[kind], cssHex(DROP_COLOR[kind]));
      this.toastTex[kind] = t.tex;
      this.toastAspect = t.aspect; // identical for all (fixed 256x64 canvas)
    }
    for (let i = 0; i < TOAST.count; i++) {
      const sp = new Sprite(new SpriteMaterial({ transparent: true, opacity: 0, depthTest: false }));
      sp.scale.set(TOAST.size * this.toastAspect, TOAST.size, 1);
      sp.visible = false;
      sp.renderOrder = 10;
      this.toasts.push(sp);
      this.toastLife.push(0);
      scene.add(sp);
    }

    // --- Locked-door barriers (pooled; shared translucent material) ---
    const barGeo = new BoxGeometry(ROOM.tileSize, ROOM.wallHeight, ROOM.tileSize);
    const barMat = new MeshBasicMaterial({
      color: PALETTE.barrier,
      transparent: true,
      opacity: BARRIER.opacity,
    });
    for (let i = 0; i < BARRIER.renderMax; i++) {
      const m = new Mesh(barGeo, barMat);
      m.visible = false;
      this.barriers.push(m);
      scene.add(m);
    }

    // --- Descent stairs: a violet floor ring + a billboarded "DESCEND" glyph,
    // shown only when the floor is cleared so the exit reads instantly. ---
    this.stairsRing = new Mesh(
      new TorusGeometry(STAIRS.ringRadius, STAIRS.ringTube, 8, 32),
      new MeshBasicMaterial({ color: PALETTE.stairs, transparent: true, opacity: STAIRS.ringOpacity }),
    );
    this.stairsRing.rotation.x = -Math.PI / 2; // lay flat on the floor
    this.stairsRing.visible = false;
    scene.add(this.stairsRing);

    // --- Bespoke BOSS mesh (Phase 8): a large armored body + head, a bright
    // WEAK-POINT marker that orbits to the vulnerable side (gimmick #1 tell), and
    // a floor ring. One per floor (the boss room); shown only while it lives. ---
    {
      // VISUAL radius only — scaled DOWN from the 1.4 gameplay radius (the hitbox /
      // #37 clamp / slam reach stay at ENEMY_TYPES.boss.radius). The weak-point
      // orbit below uses the same vr so the marker stays on the slimmed body.
      const vr = ENEMY_TYPES.boss.radius * BOSS_VFX.bodyRadiusScale;
      this.bossBodyMat = new MeshStandardMaterial({
        color: PALETTE.enemyBoss,
        emissive: PALETTE.enemyBoss,
        emissiveIntensity: BOSS_VFX.emissive,
        roughness: 0.6,
      });
      const body = new Mesh(
        new CylinderGeometry(vr * 0.85, vr, BOSS_VFX.bodyHeight, FIGURE.segments),
        this.bossBodyMat,
      );
      body.position.y = BOSS_VFX.bodyHeight / 2;
      const head = new Mesh(
        new SphereGeometry(BOSS_VFX.headRadius, FIGURE.segments, FIGURE.segments),
        this.bossBodyMat,
      );
      head.position.y = BOSS_VFX.bodyHeight + BOSS_VFX.headRadius * 0.6;
      // The weak-point marker: a glowing box that orbits the body at the radius,
      // placed each frame at the sim's vulnerableAngle so the player sees the side
      // to hit. Lives in the (non-rotating) inner group; positioned in syncBoss.
      this.bossWeakMat = new MeshStandardMaterial({
        color: PALETTE.enemyBossWeak,
        emissive: PALETTE.enemyBossWeak,
        emissiveIntensity: VFX.visorEmissive,
        roughness: 0.3,
      });
      this.bossWeak = new Mesh(
        new BoxGeometry(BOSS_VFX.weakPointSize, BOSS_VFX.weakPointSize, BOSS_VFX.weakPointSize),
        this.bossWeakMat,
      );
      this.bossWeakOrbit = vr;
      const ring = new Mesh(
        new TorusGeometry(BOSS_VFX.ringRadius, BOSS_VFX.ringTube, 8, 32),
        new MeshBasicMaterial({ color: PALETTE.enemyBoss, transparent: true, opacity: 0.5 }),
      );
      ring.rotation.x = -Math.PI / 2;
      this.bossInner = new Group();
      this.bossInner.add(body, head, this.bossWeak, ring);
      this.bossGroup = new Group();
      this.bossGroup.add(this.bossInner);
      this.bossGroup.visible = false;
      scene.add(this.bossGroup);
    }

    const descendLabel = textTexture('DESCEND', cssHex(PALETTE.stairs));
    this.stairsLabel = new Sprite(
      new SpriteMaterial({ map: descendLabel.tex, transparent: true, depthTest: false }),
    );
    this.stairsLabel.scale.set(STAIRS.glyphSize * descendLabel.aspect, STAIRS.glyphSize, 1);
    this.stairsLabel.visible = false;
    this.stairsLabel.renderOrder = 10;
    scene.add(this.stairsLabel);

    this.initBlobShadows(scene);
  }

  /** Build the shared blob-shadow texture + geometry once, then the per-entity
   *  blob pools (parallel to the figure/pickup pools). One texture + one geometry
   *  are shared across every blob; only the per-type material (opacity) and the
   *  per-mesh scale (radius) + position differ. */
  private initBlobShadows(scene: Scene): void {
    // Shared radial-alpha texture: opaque black core fading to transparent edge —
    // the soft shadow falloff. Generated once on a small canvas.
    const px = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = px;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    g.addColorStop(0, `rgba(0,0,0,${BLOB.coreAlpha})`);
    g.addColorStop(BLOB.coreStop, `rgba(0,0,0,${BLOB.coreAlpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, px, px);
    const tex = new CanvasTexture(cv);

    // Unit disc (radius 1), laid flat per-mesh via rotation.x; radius set by scale.
    this.blobGeo = new CircleGeometry(1, BLOB.segments);

    // One material per entity type (shared across that type's pool). Unlit,
    // transparent, depthWrite off so blobs never occlude each other or z-fight.
    const makeMat = (opacity: number): MeshBasicMaterial =>
      new MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity, depthWrite: false });
    const playerMat = makeMat(BLOB.player.opacity);
    const enemyMat = makeMat(BLOB.enemy.opacity);
    const bossMat = makeMat(BLOB.boss.opacity);
    const pickupMat = makeMat(BLOB.pickup.opacity);

    const makeBlob = (mat: MeshBasicMaterial, radius: number): Mesh => {
      const m = new Mesh(this.blobGeo, mat);
      m.rotation.x = -Math.PI / 2; // lay the disc flat on the floor (XZ plane)
      m.scale.setScalar(radius);
      m.position.y = BLOB.y;
      m.visible = false;
      m.renderOrder = -1; // draw under the entities (after the opaque floor)
      scene.add(m);
      return m;
    };

    this.playerBlob = makeBlob(playerMat, BLOB.player.radius);
    this.bossBlob = makeBlob(bossMat, BLOB.boss.radius);
    for (let i = 0; i < POOL.enemies; i++) this.enemyBlobs.push(makeBlob(enemyMat, BLOB.enemy.radius));
    for (let i = 0; i < POOL.pickups; i++) this.pickupBlobs.push(makeBlob(pickupMat, BLOB.pickup.radius));
  }

  /** Build the shared geometry + child offsets for a figure type. Called twice
   *  (player, enemy) at construction — never per frame. */
  private makeGeos(d: FigureDims): FigureGeos {
    return {
      body: new CylinderGeometry(d.bodyRadiusTop, d.bodyRadiusBottom, d.bodyHeight, FIGURE.segments),
      head: new SphereGeometry(d.headRadius, FIGURE.segments, FIGURE.segments),
      // A wide-but-thin bar across the front of the face (long axis = local z).
      visor: new BoxGeometry(d.visorSize * 0.5, d.visorSize * 0.7, d.visorSize * 1.7),
      bodyCenterY: d.bodyHeight / 2,
      headCenterY: d.bodyHeight + d.headRadius * 0.7,
      visorX: d.headRadius * 0.85, // poke out the +x (front) face of the head
      visorY: d.bodyHeight + d.headRadius * 0.7,
    };
  }

  /** Compose one figure (outer group → inner group → body + head + visor). The
   *  body & head share one material so combat state recolours the whole figure;
   *  the visor has its own bright always-glowing material. Front = local +x. */
  private makeFigure(geos: FigureGeos, bodyColor: number, bodyEmissive: number, visorColor: number): Figure {
    const bodyMat = new MeshStandardMaterial({
      color: bodyColor,
      emissive: bodyColor,
      emissiveIntensity: bodyEmissive,
      roughness: 0.5,
    });
    const visorMat = new MeshStandardMaterial({
      color: visorColor,
      emissive: visorColor,
      emissiveIntensity: VFX.visorEmissive,
      roughness: 0.4,
    });
    const body = new Mesh(geos.body, bodyMat);
    body.position.y = geos.bodyCenterY;
    const head = new Mesh(geos.head, bodyMat);
    head.position.y = geos.headCenterY;
    const visor = new Mesh(geos.visor, visorMat);
    visor.position.set(geos.visorX, geos.visorY, 0);

    const inner = new Group();
    inner.add(body, head, visor);
    const group = new Group();
    group.add(inner);
    return { group, inner, bodyMat };
  }

  /** Sync all meshes to the interpolated game state. Read-only on `state`. */
  sync(state: GameState, alpha: number, intent: InputIntent): void {
    const now = performance.now();
    const frameDt = this.lastNow === 0 ? 1 / 60 : Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;

    const p = state.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);

    // --- Player figure ---
    this.player.group.position.set(px, 0, py);
    this.player.group.visible = p.alive;
    // Blob shadow on the floor under the player (grounds the figure).
    this.playerBlob.position.set(px, BLOB.y, py);
    this.playerBlob.visible = p.alive;

    // Face the AIM vector (resolved exactly as the sim does; pure, no state add).
    const aim = aimDirection(p, intent, this.aim);
    this.player.group.rotation.y = Math.atan2(-aim.y, aim.x);

    // State recolour/emissive (priority: hit-flash > dodge > i-frame glow >
    // resting). Same legibility contract as the cube (PR #11) — applied to the
    // whole figure via the shared body/head material; the cube STAYS VISIBLE.
    const invuln = p.iframeTimer > 0;
    const dodging = p.dodgeFxTimer > 0;
    const mat = this.player.bodyMat;
    if (p.hitFlashTimer > 0) {
      mat.color.setHex(PALETTE.hitFlash);
      mat.emissiveIntensity = VFX.invulnEmissive;
    } else if (dodging) {
      mat.color.setHex(PALETTE.dodge);
      mat.emissiveIntensity = VFX.dodgeEmissive;
    } else if (invuln) {
      mat.color.setHex(PALETTE.invuln);
      mat.emissiveIntensity = VFX.invulnEmissive;
    } else {
      mat.color.setHex(PALETTE.player);
      mat.emissiveIntensity = VFX.playerEmissive;
    }

    // "Powered" throb while invulnerable / mid-dodge (render-only clock).
    const pulse =
      invuln || dodging
        ? 1 + VFX.invulnPulse * (0.5 + 0.5 * Math.sin(now * 0.001 * VFX.invulnPulseRate))
        : 1;
    this.player.group.scale.setScalar(pulse);

    // Dash lean — the figure tips forward (toward local +x = front) during the
    // committed burst, eased so it isn't a pop.
    const targetLean = p.dashTimer > 0 ? FIGURE.dashLean : 0;
    this.playerLean += (targetLean - this.playerLean) * (1 - Math.exp(-FIGURE.leanLerp * frameDt));
    this.player.inner.rotation.z = -this.playerLean;

    this.syncTrail(p, px, py);
    this.syncEnemies(state, alpha, px, py, now, frameDt);
    this.syncBoss(state, alpha, px, py, now);
    this.syncProjectiles(state, alpha);
    this.syncEnemyProjectiles(state, alpha);
    this.syncParticles(state);
    this.syncChainArcs(state);
    this.syncChests(state, now);
    this.syncMelee(p, px, py, aim.x, aim.y);
    this.syncPickups(state, now);
    this.syncPairChoice(state, now);
    this.syncToasts(frameDt);
    this.syncBarriers(state);
    this.syncStairs(state, now);
  }

  /** Show + pulse the descent stairs when the floor's exit is open. */
  private syncStairs(state: GameState, now: number): void {
    const s = state.stairs;
    this.stairsRing.visible = s.active;
    this.stairsLabel.visible = s.active;
    if (!s.active) return;
    const pulse = 1 + STAIRS.pulseAmp * (0.5 + 0.5 * Math.sin(now * 0.001 * STAIRS.pulseRate));
    this.stairsRing.position.set(s.x, STAIRS.ringHeight, s.y);
    this.stairsRing.scale.setScalar(pulse);
    this.stairsLabel.position.set(s.x, STAIRS.glyphHeight, s.y);
  }

  private syncPickups(state: GameState, now: number): void {
    const bob = Math.sin(now * 0.001 * PICKUP.bobRate) * PICKUP.bob;
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = state.pickups[i];
      const m = this.pickups[i];
      const icon = this.pickupIcons[i];

      // Collection = active last frame, inactive now. A pickup deactivates two ways:
      // COLLECTED (taken → pk.collected) or DISCARDED (a rejected pair-sibling, the
      // #70 1-of-2 link). Toast ONLY the collected one — else the discarded sibling
      // also announces itself ("both toasts" bug). Fire a rising "+HP" / "PIERCE" toast.
      if (this.prevPickupActive[i] && !pk.active && pk.collected) {
        this.spawnToast(pk.x, pk.y, pk.kind);
      }
      this.prevPickupActive[i] = pk.active;

      if (!pk.active) {
        m.visible = false;
        icon.visible = false;
        this.pickupBlobs[i].visible = false;
        continue;
      }
      const color = DROP_COLOR[pk.kind];
      m.visible = true;
      m.position.set(pk.x, PICKUP.height + bob, pk.y);
      // Blob stays on the FLOOR (not at the bob height) — grounds the float.
      this.pickupBlobs[i].position.set(pk.x, BLOB.y, pk.y);
      this.pickupBlobs[i].visible = true;
      m.rotation.y = now * PICKUP.spinRate;
      // PRESENTATION beckon: while a pick is in its spawn grace (chest 1-of-2 choice,
      // not yet collectable) it swells + pulses so the "choose one" reads clearly.
      const present = pk.spawnGrace > 0 ? 1 + PICKUP.presentPulse * (0.5 + 0.5 * Math.sin(now * PICKUP.presentPulseRate)) : 1;
      m.scale.setScalar(present);
      const mat = this.pickupMats[i];
      mat.color.setHex(color);
      mat.emissive.setHex(color);

      // Floating type-icon (the legibility win): cross = health, arrow = pierce,
      // burst = knockback.
      icon.visible = true;
      icon.material = this.iconMats[pk.kind];
      icon.position.set(pk.x, PICKUP.height + PICKUP.iconOffset + bob, pk.y);
    }
  }

  /** Activate a pooled toast at (x, y) for the collected kind. */
  private spawnToast(x: number, y: number, kind: PickupKind): void {
    for (let i = 0; i < this.toasts.length; i++) {
      if (this.toastLife[i] > 0) continue;
      const sp = this.toasts[i];
      const m = sp.material as SpriteMaterial;
      m.map = this.toastTex[kind];
      m.needsUpdate = true;
      sp.position.set(x, PICKUP.height + TOAST.startOffset, y);
      sp.visible = true;
      this.toastLife[i] = TOAST.lifetime;
      return;
    }
  }

  /** Rise + fade active toasts. */
  private syncToasts(frameDt: number): void {
    for (let i = 0; i < this.toasts.length; i++) {
      if (this.toastLife[i] <= 0) continue;
      this.toastLife[i] -= frameDt;
      const sp = this.toasts[i];
      const m = sp.material as SpriteMaterial;
      if (this.toastLife[i] <= 0) {
        sp.visible = false;
        m.opacity = 0;
        continue;
      }
      const t = this.toastLife[i] / TOAST.lifetime; // 1 -> 0
      sp.position.y += TOAST.rise * frameDt;
      m.opacity = t; // fade out as it rises
    }
  }

  private syncBarriers(state: GameState): void {
    // Show barriers across the active (locked) room's doorways; hide otherwise.
    const ts = state.room.tileSize;
    let n = 0;
    if (state.activeRoom >= 0 && state.activeRoom < state.rooms.length) {
      const cells = state.rooms[state.activeRoom].doorCells;
      n = Math.min(cells.length, this.barriers.length);
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        const m = this.barriers[i];
        m.position.set((c.tx + 0.5) * ts, ROOM.wallHeight / 2, (c.ty + 0.5) * ts);
        m.visible = true;
      }
    }
    for (let i = n; i < this.barriers.length; i++) this.barriers[i].visible = false;
  }

  private syncTrail(p: GameState['player'], px: number, py: number): void {
    for (let i = this.trail.length - 1; i > 0; i--) {
      this.trailX[i] = this.trailX[i - 1];
      this.trailY[i] = this.trailY[i - 1];
    }
    this.trailX[0] = px;
    this.trailY[0] = py;

    const show = p.dashTimer > 0 || p.iframeTimer > 0;
    for (let i = 0; i < this.trail.length; i++) {
      const m = this.trail[i];
      if (!show) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(this.trailX[i], this.playerBodyCenterY, this.trailY[i]);
      (m.material as MeshBasicMaterial).opacity = VFX.trailOpacity * (1 - i / this.trail.length);
    }
  }

  private syncEnemies(
    state: GameState,
    alpha: number,
    px: number,
    py: number,
    now: number,
    frameDt: number,
  ): void {
    const list = state.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      // Death-POP trigger (frame-diff active→false). The boss is excluded (its
      // death is juiced separately); reduce-motion skips the pop (motion) — the
      // colored burst (information) still fires from the sim regardless.
      if (this.enemyPrevActive[i] && !e.active && e.type !== 'boss' && !this.reduceMotion) {
        this.enemyDyingTimer[i] = KILL.popDuration;
      }
      this.enemyPrevActive[i] = e.active;

      // The boss is a bespoke mesh (syncBoss), not a pooled figure — hide every
      // pooled-kind figure at this slot and skip (no enemyFigs.boss pool exists).
      if (e.type === 'boss') {
        for (const kind of ENEMY_KINDS) this.enemyFigs[kind][i].group.visible = false;
        this.enemyBlobs[i].visible = false; // the boss uses its own (larger) blob
        continue;
      }
      // Show the figure matching this slot's enemy type; hide every other kind's
      // figure at this slot (slots are reused across types as the pool recycles).
      const fig = this.enemyFigs[e.type][i];
      for (const kind of ENEMY_KINDS) {
        if (kind !== e.type) this.enemyFigs[kind][i].group.visible = false;
      }
      if (!e.active) {
        this.enemyBlobs[i].visible = false;
        // Play the death pop on the dead figure until it elapses, then hide. The
        // dead enemy isn't moving, so (e.x, e.y) is its final position. If the slot
        // recycles (active→true) the normal branch below takes over → pop aborts.
        if (this.enemyDyingTimer[i] > 0) {
          this.enemyDyingTimer[i] = Math.max(0, this.enemyDyingTimer[i] - frameDt);
          fig.group.visible = true;
          fig.group.position.set(e.x, 0, e.y);
          fig.group.scale.setScalar(killPopScale(this.enemyDyingTimer[i]));
        } else {
          fig.group.visible = false;
        }
        continue;
      }
      // Active → cancel any lingering pop on this slot (it's a live enemy now).
      this.enemyDyingTimer[i] = 0;
      fig.group.visible = true;
      const ex = lerp(e.prevX, e.x, alpha);
      const ey = lerp(e.prevY, e.y, alpha);
      fig.group.position.set(ex, 0, ey);
      this.enemyBlobs[i].position.set(ex, BLOB.y, ey);
      this.enemyBlobs[i].visible = true;

      // Face the player (chase/telegraph/strike target). Keep prior facing if
      // exactly coincident (degenerate).
      const dx = px - ex;
      const dy = py - ey;
      if (dx * dx + dy * dy > 1e-6) fig.group.rotation.y = Math.atan2(-dy, dx);

      const mat = fig.bodyMat;
      // Recolour priority: hit-flash > STUN > BURN > FROZEN > telegraph > resting. Sway
      // is reset here and only re-applied by the stun branch (so a recovered enemy stops).
      fig.inner.rotation.z = 0;
      if (e.flashTimer > 0) {
        // Crisp PEAK (juice PR-2): brightest at the impact instant, decaying fast
        // (quadratic) toward the resting emissive over the flash window — a sharp
        // bloom-flaring punch, not a flat white hold. Brief = clarity-safe.
        const fr = e.flashTimer / ENEMY_COMMON.flash; // 1 at impact → 0 at end
        mat.color.setHex(PALETTE.hitFlash);
        mat.emissiveIntensity = VFX.enemyEmissive + (VFX.hitFlashPeak - VFX.enemyEmissive) * fr * fr;
        fig.group.scale.setScalar(1);
      } else if (e.stunTimer > 0) {
        // STUNNED (Phase 9 PR2): cold disabled tint + a dazed sway, so the CC
        // reads. No telegraph grow (the AI — and its phase tell — is frozen).
        mat.color.setHex(PALETTE.enemyStunned);
        mat.emissiveIntensity = VFX.enemyEmissive;
        fig.group.scale.setScalar(1);
        fig.inner.rotation.z = Math.sin(now * VFX.stunSwayRate) * VFX.stunSwayAmp;
      } else if (e.burnTimer > 0) {
        // BURNING (synergy arc PR2): ember-orange DoT glow so "it's on fire" reads.
        // Below stun (a stunned-and-burning enemy shows the CC) but above telegraph.
        mat.color.setHex(PALETTE.enemyBurning);
        mat.emissiveIntensity = VFX.invulnEmissive; // hotter glow than the resting tint
        fig.group.scale.setScalar(1);
      } else if (e.slowTimer > 0) {
        // FROZEN/SLOWED (meta PR1): icy cyan so "I slowed it" reads. Below burn (a
        // burning-and-slowed enemy shows the DoT); the enemy still acts (telegraph can
        // still grow next frame once the slow expires).
        mat.color.setHex(PALETTE.enemyFrozen);
        mat.emissiveIntensity = VFX.enemyEmissive;
        fig.group.scale.setScalar(1);
      } else if (e.phase === 'telegraph') {
        // Wind-up tell (shared across types): warning colour + grow toward the
        // strike. Scale uses the type's own telegraph duration.
        mat.color.setHex(PALETTE.enemyTelegraph);
        mat.emissiveIntensity = VFX.enemyEmissive;
        const t = 1 - e.timer / ENEMY_TYPES[e.type].telegraph; // 0 -> 1 across wind-up
        fig.group.scale.setScalar(1 + VFX.telegraphScale * t);
      } else {
        mat.color.setHex(ENEMY_BODY_COLOR[e.type]); // chaser red / ranged crimson
        mat.emissiveIntensity = VFX.enemyEmissive;
        fig.group.scale.setScalar(1);
      }
    }
  }

  /** Position + recolour the bespoke boss mesh from state.boss + its pooled Enemy.
   *  Shows the rotating weak-point (gimmick #1 tell), the phase-2 escalation tint,
   *  the slam telegraph grow, and the hit / blocked-shield flashes. */
  private syncBoss(state: GameState, alpha: number, px: number, py: number, now: number): void {
    const boss = state.boss;
    const e = boss ? state.enemies[boss.slot] : null;
    if (!boss || !e || !e.active) {
      this.bossGroup.visible = false;
      this.bossBlob.visible = false;
      return;
    }
    this.bossGroup.visible = true;
    const ex = lerp(e.prevX, e.x, alpha);
    const ey = lerp(e.prevY, e.y, alpha);
    this.bossGroup.position.set(ex, 0, ey);
    this.bossBlob.position.set(ex, BLOB.y, ey);
    this.bossBlob.visible = true;
    // Face the player (whole group), so the body/head orient toward the fight.
    const dx = px - ex;
    const dy = py - ey;
    if (dx * dx + dy * dy > 1e-6) this.bossGroup.rotation.y = Math.atan2(-dy, dx);

    // Weak-point marker orbits to the sim's vulnerableAngle. That angle is in
    // WORLD space (game x/y); the group is rotated to face the player, so place
    // the marker in the group's LOCAL frame by undoing the group rotation. Game
    // (x, y) -> three (x, z); the figure faces +x, group.rotation.y = atan2(-dy,dx).
    const wa = boss.vulnerableAngle;
    const wx = Math.cos(wa) * this.bossWeakOrbit;
    const wz = -Math.sin(wa) * this.bossWeakOrbit; // game y -> three z, with the -y map
    const gr = this.bossGroup.rotation.y;
    const cos = Math.cos(-gr);
    const sin = Math.sin(-gr);
    this.bossWeak.position.set(wx * cos - wz * sin, BOSS_VFX.weakPointHeight, wx * sin + wz * cos);

    const phase2 = boss.outerPhase === 2;
    const baseColor = phase2 ? PALETTE.enemyBossPhase2 : PALETTE.enemyBoss;
    const mat = this.bossBodyMat;
    // Capture the active attack's full telegraph duration on ENTRY (slam vs the
    // longer cleave, and phase 2's shortened wind-up all differ) so the scale ramp
    // below is correct for every attack. e.timer is monotonic within a telegraph.
    if (e.phase === 'telegraph' && this.bossPrevPhase !== 'telegraph') this.bossTeleMax = e.timer;
    this.bossPrevPhase = e.phase;
    // Body recolour priority: hit flash > STAGGER (interrupt payoff) > telegraph >
    // resting tint. Stagger outranks telegraph so a successful interrupt reads as
    // "you broke its attack / shield's down" the instant it lands.
    if (e.flashTimer > 0) {
      mat.color.setHex(PALETTE.hitFlash);
      mat.emissiveIntensity = VFX.invulnEmissive;
      this.bossGroup.scale.setScalar(1);
    } else if (boss.staggerTimer > 0) {
      mat.color.setHex(PALETTE.enemyBossStagger);
      mat.emissiveIntensity = VFX.invulnEmissive;
      this.bossGroup.scale.setScalar(1);
    } else if (e.phase === 'telegraph') {
      mat.color.setHex(PALETTE.enemyTelegraph);
      mat.emissiveIntensity = VFX.enemyEmissive;
      const t = this.bossTeleMax > 0 ? 1 - e.timer / this.bossTeleMax : 0; // 0 -> 1 across wind-up
      this.bossGroup.scale.setScalar(1 + BOSS_VFX.telegraphScale * t);
    } else {
      mat.color.setHex(baseColor);
      mat.emissiveIntensity = BOSS_VFX.emissive;
      this.bossGroup.scale.setScalar(1);
    }
    // Weak-point marker: flashes the SHIELD colour on a blocked (armored) hit,
    // otherwise glows the weak-point amber (pulsing so it draws the eye).
    if (boss.blockedFlash > 0) {
      this.bossWeakMat.color.setHex(PALETTE.enemyBossShield);
      this.bossWeakMat.emissive.setHex(PALETTE.enemyBossShield);
    } else {
      this.bossWeakMat.color.setHex(PALETTE.enemyBossWeak);
      this.bossWeakMat.emissive.setHex(PALETTE.enemyBossWeak);
    }
    const pulse = 1 + BOSS_VFX.weakPointPulseAmp * (0.5 + 0.5 * Math.sin(now * BOSS_VFX.weakPointPulseRate));
    this.bossWeak.scale.setScalar(pulse);
  }

  private syncEnemyProjectiles(state: GameState, alpha: number): void {
    const list = state.enemyProjectiles;
    for (let i = 0; i < this.enemyProjectiles.length; i++) {
      const pr = list[i];
      const m = this.enemyProjectiles[i];
      if (!pr.active) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(lerp(pr.prevX, pr.x, alpha), VFX.projectileHeight, lerp(pr.prevY, pr.y, alpha));
    }
  }

  private syncProjectiles(state: GameState, alpha: number): void {
    const list = state.projectiles;
    for (let i = 0; i < this.projectiles.length; i++) {
      const pr = list[i];
      const m = this.projectiles[i];
      if (!pr.active) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(lerp(pr.prevX, pr.x, alpha), VFX.projectileHeight, lerp(pr.prevY, pr.y, alpha));
    }
  }

  private syncParticles(state: GameState): void {
    const list = state.particles;
    for (let i = 0; i < this.particles.length; i++) {
      const pa = list[i];
      const m = this.particles[i];
      if (!pa.active) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.material = this.particleMaterial(pa.tint); // white spark, or a death-burst hue
      m.position.set(pa.x, VFX.particleHeight, pa.y);
      m.scale.setScalar(Math.max(0.001, pa.life / pa.maxLife));
    }
  }

  /** Shared material for a particle tint (0 = white spark). Lazily created + cached
   *  the first time a hue appears (≤ a handful ever) — no per-particle allocation. */
  private particleMaterial(tint: number): MeshBasicMaterial {
    let mat = this.particleMats.get(tint);
    if (!mat) {
      mat = new MeshBasicMaterial({ color: tint });
      this.particleMats.set(tint, mat);
    }
    return mat;
  }

  /** Draw the pooled chain-arc bolts (synergy arc PR3): a line between each chained
   *  pair, fading by life/maxLife. Game (x, y) -> three (x, z) at CHAIN_ARC.height. */
  private syncChainArcs(state: GameState): void {
    const list = state.chainArcs;
    for (let i = 0; i < this.chainArcs.length; i++) {
      const a = list[i];
      const line = this.chainArcs[i];
      const mat = line.material as LineBasicMaterial;
      if (!a.active) {
        line.visible = false;
        continue;
      }
      line.visible = true;
      const pos = line.geometry.getAttribute('position') as Float32BufferAttribute;
      pos.setXYZ(0, a.x1, CHAIN_ARC.height, a.y1);
      pos.setXYZ(1, a.x2, CHAIN_ARC.height, a.y2);
      pos.needsUpdate = true;
      mat.opacity = Math.max(0, a.life / a.maxLife); // fade out over its lifetime
    }
  }

  /** CHEST CHOICE legibility: tether the two paired picks (same pairId, both active)
   *  with a warm-gold LINE and float a "CHOOSE ONE" billboard over their midpoint, so
   *  the pick-1-of-2 reads as a CHOICE (not "collect both"). Purely render — keyed off
   *  existing sim state: when one is taken the sibling despawns, the pair no longer
   *  exists, and the link + label hide automatically (no sim coupling). The label
   *  opacity breathes to draw the eye; reduce-motion stills it (the link is static). */
  private syncPairChoice(state: GameState, now: number): void {
    const picks = state.pickups;
    let slot = 0;
    for (let i = 0; i < picks.length && slot < this.pairLinks.length; i++) {
      const a = picks[i];
      if (!a.active || a.pairId < 0) continue;
      // Find the sibling AFTER i (so each pair is handled once, at its lower index).
      let b: (typeof picks)[number] | null = null;
      for (let j = i + 1; j < picks.length; j++) {
        const cand = picks[j];
        if (cand.active && cand.pairId === a.pairId) {
          b = cand;
          break;
        }
      }
      if (!b) continue; // sibling already taken → the choice resolved → no link

      const line = this.pairLinks[slot];
      line.visible = true;
      const pos = line.geometry.getAttribute('position') as Float32BufferAttribute;
      pos.setXYZ(0, a.x, CHEST_CHOICE.linkHeight, a.y);
      pos.setXYZ(1, b.x, CHEST_CHOICE.linkHeight, b.y);
      pos.needsUpdate = true;

      const label = this.pairLabels[slot];
      label.visible = true;
      label.position.set((a.x + b.x) / 2, CHEST_CHOICE.labelHeight, (a.y + b.y) / 2);
      slot++;
    }
    // Hide unused pooled slots.
    for (let k = slot; k < this.pairLinks.length; k++) {
      this.pairLinks[k].visible = false;
      this.pairLabels[k].visible = false;
    }
    // "CHOOSE ONE" breathes (shared material → all labels together); stilled flat under
    // reduce-motion (held at full opacity, no pulse).
    this.pairLabelMat.opacity = this.reduceMotion
      ? 1
      : CHEST_CHOICE.labelPulseMin + (1 - CHEST_CHOICE.labelPulseMin) * (0.5 + 0.5 * Math.sin(now * CHEST_CHOICE.labelPulseRate));
  }

  /** Accessibility reduce-motion (set by main.ts from Settings, mirroring HUD). Stills
   *  the chest idle bob/sway/glow-pulse; the brief open-reveal stays (discrete feedback). */
  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** Draw the golden chests (PR-B): a glowing 3D chest while closed (bob + sway +
   *  emissive pulse — the "treasure, come get me" beckon), then a lid-fling reveal on
   *  open. The open is frame-diffed off the sim `opened` flag (render-only — no sim
   *  timer), so src/game stays untouched. Reduce-motion stills the idle motion. */
  private syncChests(state: GameState, now: number): void {
    const list = state.chests;
    const rm = this.reduceMotion;
    // Idle emissive PULSE (shared material → all chests glow together). Base glow
    // stays under reduce-motion (it's light, not motion); only the pulse is stilled.
    this.chestGoldMat.emissiveIntensity = rm
      ? CHEST.emissive
      : CHEST.emissive + CHEST.glowPulseAmp * (0.5 + 0.5 * Math.sin(now * 0.001 * CHEST.glowPulseRate));
    for (let i = 0; i < this.chests.length; i++) {
      const c = list[i];
      const g = this.chests[i];
      const lid = this.chestLids[i];
      if (!c.active) {
        g.visible = false;
        this.chestPrevOpened[i] = false;
        this.chestOpenStart[i] = -1;
        continue;
      }
      // Frame-diff: mark the wall-clock ms the chest opened (start of the reveal).
      if (c.opened && !this.chestPrevOpened[i]) this.chestOpenStart[i] = now;
      this.chestPrevOpened[i] = c.opened;

      if (c.mimicFighting) {
        // MIMIC burst-out: the chest SHAKES for the tell (wobbleDuration), then hides —
        // revealing the mimic (already spawned + stunned beneath it). Reduce-motion
        // stills the shake but keeps the timing (the burst particles + the reveal still
        // read). The mimic itself renders via the normal chaser path.
        const elapsed = (now - this.chestOpenStart[i]) * 0.001;
        if (elapsed >= CHEST.wobbleDuration) {
          g.visible = false;
          continue;
        }
        g.visible = true;
        const sh = rm ? 0 : CHEST.wobbleAmp;
        g.position.set(c.x + Math.sin(now * CHEST.wobbleFreqX) * sh, CHEST.bodyHeight, c.y + Math.cos(now * CHEST.wobbleFreqY) * sh);
        g.rotation.y = rm ? 0 : Math.sin(now * CHEST.wobbleFreqRot) * CHEST.wobbleRot;
        g.scale.setScalar(1);
        lid.rotation.x = 0;
        continue;
      }

      if (!c.opened) {
        // CLOSED — idle beckon: bob + gentle sway + (global) glow pulse. Lid shut.
        g.visible = true;
        const bob = rm ? CHEST.bodyHeight : CHEST.bodyHeight + CHEST.bobAmp * (0.5 + 0.5 * Math.sin(now * 0.001 * CHEST.bobRate));
        g.position.set(c.x, bob, c.y);
        g.rotation.y = rm ? 0 : CHEST.swayAmp * Math.sin(now * 0.001 * CHEST.swayRate);
        g.scale.setScalar(1);
        lid.rotation.x = 0;
        // MIMIC-READY (PR-C): a sim wobble/mimic-pending signal would play a shake
        // here (offset g.position / jitter g.rotation) BEFORE the open below.
        continue;
      }

      // OPENED — the lid-fling reveal, then hide. Plays even under reduce-motion (a
      // short, informative one-shot, not continuous motion).
      const elapsed = (now - this.chestOpenStart[i]) * 0.001; // seconds
      if (elapsed >= CHEST.openDuration) {
        g.visible = false; // reveal done; the popped pickups carry on via the pickup path
        continue;
      }
      g.visible = true;
      g.position.set(c.x, CHEST.bodyHeight, c.y);
      g.rotation.y = 0;
      const t = elapsed / CHEST.openDuration; // 0..1
      const ease = 1 - (1 - t) * (1 - t); // ease-out: snappy fling, soft settle
      lid.rotation.x = -CHEST.lidOpenAngle * ease;
      g.scale.setScalar(1 + CHEST.openPopScale * Math.sin(Math.PI * t)); // brief swell
    }
  }

  private syncMelee(
    p: GameState['player'],
    px: number,
    py: number,
    aimX: number,
    aimY: number,
  ): void {
    if (p.meleeAnimTimer <= 0) {
      this.meleeGroup.visible = false;
      return;
    }
    this.meleeGroup.visible = true;
    this.meleeGroup.position.set(px, VFX.meleeArcHeight, py);
    // Aim the swing along the resolved aim (matches both the figure's facing and
    // the actual hit direction, which the sim also resolves from aim).
    this.meleeGroup.rotation.y = Math.atan2(-aimY, aimX);
    this.meleeMat.opacity = VFX.meleeArcOpacity * (p.meleeAnimTimer / MELEE.active);
  }
}
