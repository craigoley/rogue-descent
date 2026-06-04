import { describe, expect, it } from 'vitest';
import { createGameState, update, regenerate, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import type { RoomState } from '../Room';
import { spawnEnemy, updateEnemies } from '../Enemy';
import {
  createEnemyProjectilePool,
  fireEnemyProjectile,
  updateEnemyProjectiles,
  activeEnemyProjectileCount,
} from '../EnemyProjectile';
import { damageEnemy } from '../Combat';
import { rangedCountForDepth, enemiesPerRoomForDepth, healthMultForDepth, speedMultForDepth, damageMultForDepth } from '../Difficulty';
import { ENEMY_TYPES, POOL, PLAYER_COMBAT, SIM_DT, TUNING, DIFFICULTY } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/** A large OPEN room (solid border, empty interior) — the hand-authored TEST_ROOM
 *  is only 14x14 with pillars, too small to test kiting at the ranged standoff. */
function openRoom(tiles = 40): RoomState {
  const solid = new Array<boolean>(tiles * tiles).fill(false);
  for (let t = 0; t < tiles; t++) {
    solid[t] = true; // top
    solid[(tiles - 1) * tiles + t] = true; // bottom
    solid[t * tiles] = true; // left
    solid[t * tiles + tiles - 1] = true; // right
  }
  return { tilesX: tiles, tilesY: tiles, tileSize: 1, walls: [], solid };
}

/** Big open arena with the encounter system disabled — ranged-AI mechanics tested
 *  in isolation, not against a generated floor. Player at the centre. */
function arena(): GameState {
  const s = createGameState();
  s.room = openRoom(40);
  const cx = 20;
  const cy = 20;
  s.spawn = { x: cx, y: cy };
  s.player = createPlayer(cx, cy);
  for (const e of s.enemies) e.active = false;
  for (const p of s.enemyProjectiles) p.active = false;
  s.rooms = [];
  s.activeRoom = -1;
  return s;
}

const distToPlayer = (s: GameState, e: { x: number; y: number }): number =>
  Math.hypot(e.x - s.player.x, e.y - s.player.y);

describe('Ranged enemy — kiting', () => {
  it('closes in when too far (beyond its standoff)', () => {
    const s = arena();
    const R = ENEMY_TYPES.ranged;
    spawnEnemy(s.enemies, s.player.x + R.preferredRange + 5, s.player.y, 1, 'ranged');
    const e = s.enemies.find((x) => x.active)!;
    const d0 = distToPlayer(s, e);
    for (let k = 0; k < 20; k++) updateEnemies(s, DT);
    expect(distToPlayer(s, e)).toBeLessThan(d0); // moved toward its standoff
  });

  it('backs off when the player crowds it (inside its standoff)', () => {
    const s = arena();
    const R = ENEMY_TYPES.ranged;
    spawnEnemy(s.enemies, s.player.x + (R.preferredRange - R.rangeBand - 1.5), s.player.y, 1, 'ranged');
    const e = s.enemies.find((x) => x.active)!;
    const d0 = distToPlayer(s, e);
    // While inside the band it's in 'chase' and retreats; assert it opened distance
    // before it ever settles to fire.
    let backedOff = false;
    for (let k = 0; k < 20 && !backedOff; k++) {
      updateEnemies(s, DT);
      if (distToPlayer(s, e) > d0 + 0.2) backedOff = true;
    }
    expect(backedOff).toBe(true);
  });
});

describe('Ranged enemy — telegraph then fire', () => {
  it('at standoff it telegraphs, then fires exactly one bolt', () => {
    const s = arena();
    const R = ENEMY_TYPES.ranged;
    spawnEnemy(s.enemies, s.player.x + R.preferredRange, s.player.y, 1, 'ranged');
    const e = s.enemies.find((x) => x.active)!;

    // First step: at standoff -> enters telegraph (the wind-up tell).
    updateEnemies(s, DT);
    expect(e.phase).toBe('telegraph');
    expect(activeEnemyProjectileCount(s.enemyProjectiles)).toBe(0); // no shot during wind-up

    // Run out the telegraph -> strike fires ONE bolt.
    const steps = Math.ceil(R.telegraph / DT) + 2;
    for (let k = 0; k < steps; k++) updateEnemies(s, DT);
    expect(activeEnemyProjectileCount(s.enemyProjectiles)).toBe(1);
  });
});

describe('Ranged enemy — the bolt hits the player (and dash negates it)', () => {
  it('a bolt overlapping the player calls damagePlayer (loses HP)', () => {
    const s = arena();
    s.player.health = PLAYER_COMBAT.maxHealth;
    // Bolt just in front of the player, flying into it.
    fireEnemyProjectile(s.enemyProjectiles, s.player.x + 0.5, s.player.y, -1, 0, 12);
    updateEnemyProjectiles(s, DT);
    expect(s.player.health).toBe(PLAYER_COMBAT.maxHealth - 12);
    expect(activeEnemyProjectileCount(s.enemyProjectiles)).toBe(0); // despawned on hit
  });

  it('dash i-frames negate the bolt (no HP lost)', () => {
    const s = arena();
    s.player.health = PLAYER_COMBAT.maxHealth;
    s.player.iframeTimer = 1; // mid-dash
    fireEnemyProjectile(s.enemyProjectiles, s.player.x + 0.5, s.player.y, -1, 0, 12);
    updateEnemyProjectiles(s, DT);
    expect(s.player.health).toBe(PLAYER_COMBAT.maxHealth); // i-frames ate it
  });
});

describe('Ranged enemy — fragile up close', () => {
  it('has less HP than the chaser, and dies in fewer hits', () => {
    expect(ENEMY_TYPES.ranged.maxHealth).toBeLessThan(ENEMY_TYPES.chaser.maxHealth);

    const hits = (type: 'chaser' | 'ranged'): number => {
      const s = arena();
      spawnEnemy(s.enemies, s.player.x + 2, s.player.y, 1, type);
      const e = s.enemies.find((x) => x.active)!;
      let n = 0;
      while (e.active && n < 50) {
        damageEnemy(e, TUNING.rangedDamage, 1, 0, 0, s);
        n++;
      }
      return n;
    };
    expect(hits('ranged')).toBeLessThan(hits('chaser'));
  });
});

describe('Ranged enemy — enemy-projectile pool is fixed-size', () => {
  it('does not grow under sustained fire; caps at POOL.enemyProjectiles', () => {
    const pool = createEnemyProjectilePool();
    expect(pool.length).toBe(POOL.enemyProjectiles);
    for (let i = 0; i < POOL.enemyProjectiles; i++) {
      expect(fireEnemyProjectile(pool, 0, 0, 1, 0, 5)).toBe(true);
    }
    expect(fireEnemyProjectile(pool, 0, 0, 1, 0, 5)).toBe(false); // full -> dropped
    expect(pool.length).toBe(POOL.enemyProjectiles); // never grew
    expect(activeEnemyProjectileCount(pool)).toBe(POOL.enemyProjectiles);
  });
});

describe('Ranged enemy — 7c depth scaling applies', () => {
  it('a depth-5 ranged enemy is scaled by the difficulty curve', () => {
    const s = arena();
    spawnEnemy(s.enemies, s.player.x + 6, s.player.y, 5, 'ranged');
    const e = s.enemies.find((x) => x.active)!;
    const R = ENEMY_TYPES.ranged;
    expect(e.health).toBeCloseTo(R.maxHealth * healthMultForDepth(5), 9);
    expect(e.moveSpeed).toBeCloseTo(R.moveSpeed * speedMultForDepth(5), 9);
    expect(e.attackDamage).toBeCloseTo(R.attackDamage * damageMultForDepth(5), 9);
  });
});

describe('Ranged spawn mix — deterministic count rule (no RNG)', () => {
  it('no ranged below rangedMinDepth; at least one at/after it', () => {
    expect(rangedCountForDepth(1)).toBe(0);
    expect(rangedCountForDepth(DIFFICULTY.rangedMinDepth - 1)).toBe(0);
    expect(rangedCountForDepth(DIFFICULTY.rangedMinDepth)).toBeGreaterThanOrEqual(1);
  });

  it('always leaves at least one chaser (ranged < total)', () => {
    for (let d = 1; d <= 12; d++) {
      expect(rangedCountForDepth(d)).toBeLessThan(enemiesPerRoomForDepth(d));
    }
  });

  /** Activate this floor's first idle room at `depth` and return the live enemies. */
  function activateRoomEnemies(s: GameState, depth: number): GameState['enemies'] {
    s.run.depth = depth;
    regenerate(s, s.seed);
    const i = s.rooms.findIndex((r, idx) => idx > 0 && r.phase === 'idle');
    const r = s.rooms[i].rect;
    const ts = s.room.tileSize;
    s.player.x = (r.x + r.w / 2) * ts;
    s.player.y = (r.y + r.h / 2) * ts;
    update(s, idle(), DT);
    return s.enemies.filter((e) => e.active);
  }

  it('spawned mix matches the curve: total + ranged counts, and the rest chasers', () => {
    const depth = 5;
    const live = activateRoomEnemies(createGameState(), depth);
    const ranged = live.filter((e) => e.type === 'ranged').length;
    const chasers = live.filter((e) => e.type === 'chaser').length;
    expect(live.length).toBe(enemiesPerRoomForDepth(depth));
    expect(ranged).toBe(rangedCountForDepth(depth));
    expect(chasers).toBe(live.length - ranged);
    expect(chasers).toBeGreaterThanOrEqual(1); // mixed fight always has a chaser
  });

  it('depth below K spawns pure chaser', () => {
    const live = activateRoomEnemies(createGameState(), DIFFICULTY.rangedMinDepth - 1);
    expect(live.every((e) => e.type === 'chaser')).toBe(true);
  });

  it('same seed + depth => identical type mix (deterministic)', () => {
    const a = activateRoomEnemies(createGameState(), 6);
    const b = activateRoomEnemies(createGameState(), 6);
    expect(a.map((e) => e.type)).toEqual(b.map((e) => e.type));
  });

  it('a mixed pool never grows past POOL.enemies', () => {
    const s = arena();
    let spawned = 0;
    for (let i = 0; i < POOL.enemies + 4; i++) {
      const type = i % 2 === 0 ? 'chaser' : 'ranged';
      if (spawnEnemy(s.enemies, i, 0, 1, type)) spawned++;
    }
    expect(spawned).toBe(POOL.enemies); // extras dropped
    expect(s.enemies.length).toBe(POOL.enemies); // never grew
  });
});
