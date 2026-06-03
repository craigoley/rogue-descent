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
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
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
  ENEMY,
  FIGURE,
  MELEE,
  PALETTE,
  PICKUP,
  POOL,
  RANGED,
  ROOM,
  STAIRS,
  TOAST,
  VFX,
} from '../utils/constants';
import { lerp, type Vec2 } from '../utils/math';

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

/** Per-drop-kind presentation: VERB/system colour + glyph + toast label. The
 *  verb powerups borrow their verb colour (pierce = ranged blue, knockback =
 *  melee orange); the three DASH powerups share the dash magenta and differ by
 *  glyph; health keeps its own green. */
const DROP_COLOR: Record<PickupKind, number> = {
  health: PALETTE.pickupHealth,
  pierce: PALETTE.projectile,
  knockback: PALETTE.melee,
  extraCharge: PALETTE.dash,
  fasterRecharge: PALETTE.dash,
  dashStrike: PALETTE.dash,
};
const DROP_GLYPH: Record<PickupKind, (g: CanvasRenderingContext2D, s: number, color: string) => void> = {
  health: drawCross,
  pierce: drawArrow,
  knockback: drawBurst,
  extraCharge: drawDoubleChevron,
  fasterRecharge: drawRecharge,
  dashStrike: drawBladeDash,
};
const DROP_LABEL: Record<PickupKind, string> = {
  health: '+HP',
  pierce: 'PIERCE',
  knockback: 'KNOCKBACK',
  extraCharge: 'EXTRA DASH',
  fasterRecharge: 'FAST DASH',
  dashStrike: 'DASH STRIKE',
};
const DROP_KINDS: PickupKind[] = [
  'health',
  'pierce',
  'knockback',
  'extraCharge',
  'fasterRecharge',
  'dashStrike',
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

  private readonly enemies: Figure[] = [];
  private readonly projectiles: Mesh[] = [];
  private readonly particles: Mesh[] = [];
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

    // --- Enemy figures (pooled; shared geometry, per-enemy materials) ---
    const enemyGeos = this.makeGeos(FIGURE.enemy);
    for (let i = 0; i < POOL.enemies; i++) {
      const fig = this.makeFigure(enemyGeos, PALETTE.enemy, VFX.enemyEmissive, PALETTE.enemyTelegraph);
      fig.group.visible = false;
      this.enemies.push(fig);
      scene.add(fig.group);
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

    // --- Hit-spark particles (pooled, shared material) ---
    const partGeo = new BoxGeometry(VFX.particleSize, VFX.particleSize, VFX.particleSize);
    const partMat = new MeshBasicMaterial({ color: PALETTE.spark });
    for (let i = 0; i < POOL.particles; i++) {
      const m = new Mesh(partGeo, partMat);
      m.visible = false;
      this.particles.push(m);
      scene.add(m);
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

    const descendLabel = textTexture('DESCEND', cssHex(PALETTE.stairs));
    this.stairsLabel = new Sprite(
      new SpriteMaterial({ map: descendLabel.tex, transparent: true, depthTest: false }),
    );
    this.stairsLabel.scale.set(STAIRS.glyphSize * descendLabel.aspect, STAIRS.glyphSize, 1);
    this.stairsLabel.visible = false;
    this.stairsLabel.renderOrder = 10;
    scene.add(this.stairsLabel);
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
    this.syncEnemies(state, alpha, px, py);
    this.syncProjectiles(state, alpha);
    this.syncParticles(state);
    this.syncMelee(p, px, py, aim.x, aim.y);
    this.syncPickups(state, now);
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

      // Collection = active last frame, inactive now (pickups only deactivate on
      // pickup). Fire a rising "+HP" / "PIERCE" / "KNOCKBACK" toast at its position.
      if (this.prevPickupActive[i] && !pk.active) {
        this.spawnToast(pk.x, pk.y, pk.kind);
      }
      this.prevPickupActive[i] = pk.active;

      if (!pk.active) {
        m.visible = false;
        icon.visible = false;
        continue;
      }
      const color = DROP_COLOR[pk.kind];
      m.visible = true;
      m.position.set(pk.x, PICKUP.height + bob, pk.y);
      m.rotation.y = now * PICKUP.spinRate;
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

  private syncEnemies(state: GameState, alpha: number, px: number, py: number): void {
    const list = state.enemies;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = list[i];
      const fig = this.enemies[i];
      if (!e.active) {
        fig.group.visible = false;
        continue;
      }
      fig.group.visible = true;
      const ex = lerp(e.prevX, e.x, alpha);
      const ey = lerp(e.prevY, e.y, alpha);
      fig.group.position.set(ex, 0, ey);

      // Face the player (chase/telegraph/strike target). Keep prior facing if
      // exactly coincident (degenerate).
      const dx = px - ex;
      const dy = py - ey;
      if (dx * dx + dy * dy > 1e-6) fig.group.rotation.y = Math.atan2(-dy, dx);

      const mat = fig.bodyMat;
      if (e.flashTimer > 0) {
        mat.color.setHex(PALETTE.hitFlash);
        mat.emissiveIntensity = VFX.invulnEmissive;
        fig.group.scale.setScalar(1);
      } else if (e.phase === 'telegraph') {
        // Wind-up tell: warning colour + grow as the strike approaches.
        mat.color.setHex(PALETTE.enemyTelegraph);
        mat.emissiveIntensity = VFX.enemyEmissive;
        const t = 1 - e.timer / ENEMY.telegraph; // 0 -> 1 across the wind-up
        fig.group.scale.setScalar(1 + VFX.telegraphScale * t);
      } else {
        mat.color.setHex(PALETTE.enemy);
        mat.emissiveIntensity = VFX.enemyEmissive;
        fig.group.scale.setScalar(1);
      }
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
      m.position.set(pa.x, VFX.particleHeight, pa.y);
      m.scale.setScalar(Math.max(0.001, pa.life / pa.maxLife));
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
