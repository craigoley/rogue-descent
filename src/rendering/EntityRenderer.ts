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
} from 'three';
import type { GameState } from '../game/GameState';
import { aimDirection } from '../game/Combat';
import type { InputIntent } from '../game/Input';
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
  TOAST,
  VFX,
} from '../utils/constants';
import { lerp, type Vec2 } from '../utils/math';

/** 0xRRGGBB -> '#rrggbb' for canvas drawing (reuses PALETTE, no new colours). */
const cssHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A small square icon texture drawn once (cross for health, bolt for buff). */
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

/** A lightning bolt filling the icon canvas (fire-rate buff). */
function drawBolt(g: CanvasRenderingContext2D, s: number, color: string): void {
  const p = (fx: number, fy: number): [number, number] => [fx * s, fy * s];
  const pts = [
    p(0.58, 0.08),
    p(0.28, 0.54),
    p(0.46, 0.54),
    p(0.36, 0.92),
    p(0.74, 0.42),
    p(0.54, 0.42),
  ];
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fill();
}

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
  // Floating type-icons above each pickup (billboarded — always face the camera).
  private readonly pickupIcons: Sprite[] = [];
  private iconMatHealth!: SpriteMaterial;
  private iconMatBuff!: SpriteMaterial;
  /** Render-side snapshot of pickup liveness, to detect collection (-> toast). */
  private readonly prevPickupActive: boolean[] = [];
  // On-collect toasts ("+HP" / "FIRE RATE UP") — pooled, per-toast material.
  private readonly toasts: Sprite[] = [];
  private readonly toastLife: number[] = [];
  private toastTexHealth!: CanvasTexture;
  private toastTexBuff!: CanvasTexture;
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

    // --- Pickup type-icons: a ＋ cross (health) / ⚡ bolt (buff) billboard so the
    // drop's MEANING reads at a glance, not just its colour. Two shared
    // materials; one pooled sprite per pickup slot. ---
    this.iconMatHealth = new SpriteMaterial({
      map: iconTexture((g, s) => drawCross(g, s, cssHex(PALETTE.pickupHealth))),
      transparent: true,
    });
    this.iconMatBuff = new SpriteMaterial({
      map: iconTexture((g, s) => drawBolt(g, s, cssHex(PALETTE.pickupBuff))),
      transparent: true,
    });
    for (let i = 0; i < POOL.pickups; i++) {
      const sp = new Sprite(this.iconMatHealth);
      sp.scale.set(PICKUP.iconSize, PICKUP.iconSize, 1);
      sp.visible = false;
      this.pickupIcons.push(sp);
      this.prevPickupActive.push(false);
      scene.add(sp);
    }

    // --- On-collect toasts (pooled; each its own material so they fade
    // independently). Two shared textures, swapped onto a toast when it fires. ---
    const th = textTexture('+HP', cssHex(PALETTE.pickupHealth));
    const tb = textTexture('FIRE RATE UP', cssHex(PALETTE.pickupBuff));
    this.toastTexHealth = th.tex;
    this.toastTexBuff = tb.tex;
    this.toastAspect = th.aspect;
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
  }

  private syncPickups(state: GameState, now: number): void {
    const bob = Math.sin(now * 0.001 * PICKUP.bobRate) * PICKUP.bob;
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = state.pickups[i];
      const m = this.pickups[i];
      const icon = this.pickupIcons[i];

      // Collection = active last frame, inactive now (pickups only deactivate on
      // pickup). Fire a rising "+HP" / "FIRE RATE UP" toast at its position.
      if (this.prevPickupActive[i] && !pk.active) {
        this.spawnToast(pk.x, pk.y, pk.kind);
      }
      this.prevPickupActive[i] = pk.active;

      if (!pk.active) {
        m.visible = false;
        icon.visible = false;
        continue;
      }
      const color = pk.kind === 'health' ? PALETTE.pickupHealth : PALETTE.pickupBuff;
      m.visible = true;
      m.position.set(pk.x, PICKUP.height + bob, pk.y);
      m.rotation.y = now * PICKUP.spinRate;
      const mat = this.pickupMats[i];
      mat.color.setHex(color);
      mat.emissive.setHex(color);

      // Floating type-icon (the legibility win): cross = health, bolt = buff.
      icon.visible = true;
      icon.material = pk.kind === 'health' ? this.iconMatHealth : this.iconMatBuff;
      icon.position.set(pk.x, PICKUP.height + PICKUP.iconOffset + bob, pk.y);
    }
  }

  /** Activate a pooled toast at (x, y) for the collected kind. */
  private spawnToast(x: number, y: number, kind: 'health' | 'buff'): void {
    for (let i = 0; i < this.toasts.length; i++) {
      if (this.toastLife[i] > 0) continue;
      const sp = this.toasts[i];
      const m = sp.material as SpriteMaterial;
      m.map = kind === 'health' ? this.toastTexHealth : this.toastTexBuff;
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
