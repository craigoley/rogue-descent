/**
 * Combat-core audio: a SIBLING to EntityRenderer. It watches game STATE and
 * fires a sound on an observable state change — exactly mirroring how the
 * renderer diffs prev/current (e.g. an enemy's flashTimer going 0->positive =
 * a hit landed). It reads state and writes only sound; it NEVER mutates the sim,
 * and lives entirely in the output layer (src/audio/).
 *
 * Edge detection per frame (rising edges of render-observable signals):
 *   shoot  player projectile slot active false->true
 *   swing  player.meleeAnimTimer 0->>0
 *   dash   player.dashTimer 0->>0
 *   hit    enemy.flashTimer 0->>0           (CONTACT — seed-guarded)
 *   death  enemy.active true->false         (CONTACT — seed-guarded)
 *   hurt   player.hitFlashTimer 0->>0       (CONTACT — seed-guarded)
 *   dodge  player.dodgeFxTimer 0->>0
 *
 * FLOOR-RESET GUARD: loadFloor (descent/restart) deactivates every enemy and
 * recreates the player, which would otherwise read as a burst of death/hit/hurt
 * edges. On the frame game.seed changed we fire NOTHING and just refresh the
 * snapshot, so the next frame diffs cleanly with no phantom one-frame-late edge.
 */

import type { SfxSink } from './AudioEngine';

/** Minimal structural view of the state the audio layer reads (the real
 *  GameState satisfies it — keeps this decoupled + unit-testable). */
export interface AudioView {
  seed: number;
  player: {
    meleeAnimTimer: number;
    dashTimer: number;
    hitFlashTimer: number;
    dodgeFxTimer: number;
  };
  enemies: ReadonlyArray<{ active: boolean; flashTimer: number }>;
  projectiles: ReadonlyArray<{ active: boolean }>;
}

const rose = (prev: number, now: number): boolean => prev <= 0 && now > 0;

export class AudioManager {
  private readonly sink: SfxSink;
  private muted = false;

  // Render-side snapshot of the previous frame's observable signals.
  private prevSeed: number;
  private prevMeleeAnim = 0;
  private prevDashTimer = 0;
  private prevHitFlash = 0;
  private prevDodgeFx = 0;
  private readonly prevEnemyActive: boolean[] = [];
  private readonly prevEnemyFlash: number[] = [];
  private readonly prevProjActive: boolean[] = [];

  constructor(sink: SfxSink, initial: AudioView) {
    this.sink = sink;
    this.prevSeed = initial.seed;
    this.snapshot(initial); // seed the prev arrays so frame 1 fires nothing
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Diff this frame against the last + fire the matching SFX on rising edges.
   *  Call once per frame, after EntityRenderer.sync. */
  sync(game: AudioView): void {
    const seedChanged = game.seed !== this.prevSeed;
    // Fire only on a normal, same-floor, unmuted frame. On a floor-reset frame
    // (or while muted) we suppress every trigger but STILL refresh the snapshot
    // below, so the next frame has no stale/phantom edge.
    const fire = !this.muted && !seedChanged;

    if (fire) {
      const p = game.player;
      // Player ACTIONS.
      if (rose(this.prevMeleeAnim, p.meleeAnimTimer)) this.sink.play('swing');
      if (rose(this.prevDashTimer, p.dashTimer)) this.sink.play('dash');
      if (rose(this.prevDodgeFx, p.dodgeFxTimer)) this.sink.play('dodge');
      // Player CONTACT (also under the seed guard via `fire`).
      if (rose(this.prevHitFlash, p.hitFlashTimer)) this.sink.play('hurt');
      // Shots fired.
      for (let i = 0; i < game.projectiles.length; i++) {
        if (!this.prevProjActive[i] && game.projectiles[i].active) this.sink.play('shoot');
      }
      // Enemy CONTACT.
      for (let i = 0; i < game.enemies.length; i++) {
        const e = game.enemies[i];
        if (rose(this.prevEnemyFlash[i] ?? 0, e.flashTimer)) this.sink.play('hit');
        if (this.prevEnemyActive[i] && !e.active) this.sink.play('death');
      }
    }

    this.snapshot(game);
    this.prevSeed = game.seed;
  }

  /** Copy this frame's observable signals into the prev* snapshot. */
  private snapshot(game: AudioView): void {
    const p = game.player;
    this.prevMeleeAnim = p.meleeAnimTimer;
    this.prevDashTimer = p.dashTimer;
    this.prevHitFlash = p.hitFlashTimer;
    this.prevDodgeFx = p.dodgeFxTimer;
    for (let i = 0; i < game.enemies.length; i++) {
      this.prevEnemyActive[i] = game.enemies[i].active;
      this.prevEnemyFlash[i] = game.enemies[i].flashTimer;
    }
    for (let i = 0; i < game.projectiles.length; i++) {
      this.prevProjActive[i] = game.projectiles[i].active;
    }
  }
}
