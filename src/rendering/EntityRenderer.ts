/**
 * Renders all dynamic entities — player, enemies, projectiles, hit-sparks — plus
 * the melee swing and the dash trail. Everything is POOLED: a fixed set of
 * meshes created once at construction and shown/hidden/positioned each frame
 * from the (read-only) game state. Nothing allocates per frame. Positions are
 * INTERPOLATED between each entity's previous and current sim-step position by
 * the frame `alpha`, so motion is smooth at any refresh rate.
 *
 * Game (x, y) maps to three (x, z); the floor is y = 0.
 */

import {
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Scene,
} from 'three';
import type { GameState } from '../game/GameState';
import {
  ENEMY,
  MELEE,
  PALETTE,
  PLAYER,
  POOL,
  RANGED,
  VFX,
} from '../utils/constants';
import { lerp } from '../utils/math';

export class EntityRenderer {
  private readonly player: Mesh;
  private readonly playerMat: MeshStandardMaterial;
  private readonly enemies: Mesh[] = [];
  private readonly enemyMats: MeshStandardMaterial[] = [];
  private readonly projectiles: Mesh[] = [];
  private readonly particles: Mesh[] = [];
  private readonly trail: Mesh[] = [];
  private readonly trailX: number[] = [];
  private readonly trailY: number[] = [];
  private readonly meleeGroup: Group;
  private readonly meleeMat: MeshBasicMaterial;

  constructor(scene: Scene) {
    // --- Player ---
    const size = PLAYER.radius * 2;
    this.playerMat = new MeshStandardMaterial({
      color: PALETTE.player,
      emissive: PALETTE.player,
      emissiveIntensity: 0.4,
      roughness: 0.5,
    });
    this.player = new Mesh(new BoxGeometry(size, size, size), this.playerMat);
    scene.add(this.player);

    // --- Dash trail (afterimages) ---
    for (let i = 0; i < VFX.trailLength; i++) {
      const m = new Mesh(
        new BoxGeometry(size, size, size),
        new MeshBasicMaterial({ color: PALETTE.player, transparent: true, opacity: 0 }),
      );
      m.visible = false;
      this.trail.push(m);
      this.trailX.push(0);
      this.trailY.push(0);
      scene.add(m);
    }

    // --- Enemies (pooled, individual materials for per-enemy tint/flash) ---
    const eSize = ENEMY.radius * 2;
    const eGeo = new BoxGeometry(eSize, eSize, eSize);
    for (let i = 0; i < POOL.enemies; i++) {
      const mat = new MeshStandardMaterial({
        color: PALETTE.enemy,
        emissive: PALETTE.enemy,
        emissiveIntensity: 0.25,
        roughness: 0.6,
      });
      const m = new Mesh(eGeo, mat);
      m.visible = false;
      this.enemies.push(m);
      this.enemyMats.push(mat);
      scene.add(m);
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
    this.meleeMat = new MeshBasicMaterial({
      color: PALETTE.player,
      transparent: true,
      opacity: 0,
    });
    const sector = new Mesh(
      new CircleGeometry(MELEE.range, 18, -MELEE.halfArc, MELEE.halfArc * 2),
      this.meleeMat,
    );
    sector.rotation.x = -Math.PI / 2; // lay flat on the floor
    this.meleeGroup = new Group();
    this.meleeGroup.add(sector);
    this.meleeGroup.visible = false;
    scene.add(this.meleeGroup);
  }

  /** Sync all meshes to the interpolated game state. Read-only on `state`. */
  sync(state: GameState, alpha: number): void {
    const p = state.player;
    const px = lerp(p.prevX, p.x, alpha);
    const py = lerp(p.prevY, p.y, alpha);

    // Player: flash white on hit; blink (hide every other slice) during i-frames.
    this.player.position.set(px, PLAYER.radius, py);
    const flashing = p.hitFlashTimer > 0;
    this.playerMat.color.setHex(flashing ? PALETTE.hitFlash : PALETTE.player);
    this.player.visible = p.alive && !(p.iframeTimer > 0 && Math.floor(p.iframeTimer * VFX.iframeBlink) % 2 === 0);

    this.syncTrail(p, px, py);
    this.syncEnemies(state, alpha);
    this.syncProjectiles(state, alpha);
    this.syncParticles(state);
    this.syncMelee(p, px, py);
  }

  private syncTrail(p: GameState['player'], px: number, py: number): void {
    // Shift history and record the latest interpolated position.
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
      m.position.set(this.trailX[i], PLAYER.radius, this.trailY[i]);
      const mat = m.material as MeshBasicMaterial;
      mat.opacity = VFX.trailOpacity * (1 - i / this.trail.length);
    }
  }

  private syncEnemies(state: GameState, alpha: number): void {
    const list = state.enemies;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = list[i];
      const m = this.enemies[i];
      if (!e.active) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(
        lerp(e.prevX, e.x, alpha),
        ENEMY.radius,
        lerp(e.prevY, e.y, alpha),
      );
      const mat = this.enemyMats[i];
      if (e.flashTimer > 0) {
        mat.color.setHex(PALETTE.hitFlash);
        m.scale.setScalar(1);
      } else if (e.phase === 'telegraph') {
        // Wind-up tell: warning colour + grow as the strike approaches.
        mat.color.setHex(PALETTE.enemyTelegraph);
        const t = 1 - e.timer / ENEMY.telegraph; // 0 -> 1 across the wind-up
        m.scale.setScalar(1 + VFX.telegraphScale * t);
      } else {
        mat.color.setHex(PALETTE.enemy);
        m.scale.setScalar(1);
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
      m.position.set(
        lerp(pr.prevX, pr.x, alpha),
        VFX.projectileHeight,
        lerp(pr.prevY, pr.y, alpha),
      );
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

  private syncMelee(p: GameState['player'], px: number, py: number): void {
    if (p.meleeAnimTimer <= 0) {
      this.meleeGroup.visible = false;
      return;
    }
    this.meleeGroup.visible = true;
    this.meleeGroup.position.set(px, VFX.meleeArcHeight, py);
    // Aim the flat sector along the player's facing (world x,y -> three x,z).
    this.meleeGroup.rotation.y = Math.atan2(-p.facingY, p.facingX);
    this.meleeMat.opacity = VFX.meleeArcOpacity * (p.meleeAnimTimer / MELEE.active);
  }
}
