import { describe, expect, it } from 'vitest';
import { createGameState, update, regenerate, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import type { RoomState } from '../Room';
import { spawnEnemy, updateEnemies } from '../Enemy';
import { damageEnemy } from '../Combat';
import { swarmerCountForDepth, enemiesPerRoomForDepth } from '../Difficulty';
import { ENEMY_TYPES, SIM_DT, DIFFICULTY, type EnemyType } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;

/** Large OPEN room (solid border, empty interior) — room enough to test flocking
 *  and lunges at range (the hand-authored TEST_ROOM is too small). */
function openRoom(tiles = 40): RoomState {
  const solid = new Array<boolean>(tiles * tiles).fill(false);
  for (let t = 0; t < tiles; t++) {
    solid[t] = true;
    solid[(tiles - 1) * tiles + t] = true;
    solid[t * tiles] = true;
    solid[t * tiles + tiles - 1] = true;
  }
  return { tilesX: tiles, tilesY: tiles, tileSize: 1, walls: [], solid };
}

/** Big open arena, encounter system off, player at centre. */
function arena(): GameState {
  const s = createGameState();
  s.room = openRoom(40);
  s.spawn = { x: 20, y: 20 };
  s.player = createPlayer(20, 20);
  for (const e of s.enemies) e.active = false;
  s.rooms = [];
  s.activeRoom = -1;
  return s;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('Swarmer — FLOCK separation (surrounds, does not stack)', () => {
  it('a swarmer pair keeps more separation than a chaser pair (which converges)', () => {
    // Two enemies starting close together (within the swarmer sepRadius), both
    // chasing the same far player. Chasers funnel onto the same line and converge;
    // swarmers push off each other and stay spread.
    const run = (type: EnemyType): number => {
      const s = arena();
      spawnEnemy(s.enemies, 28, 19.7, 1, type);
      spawnEnemy(s.enemies, 28, 20.3, 1, type);
      const [a, b] = s.enemies.filter((e) => e.active);
      for (let k = 0; k < 30; k++) updateEnemies(s, DT);
      return dist(a, b);
    };
    const sep0 = 0.6;
    const swarmSep = run('swarmer');
    const chaseSep = run('chaser');
    expect(swarmSep).toBeGreaterThan(chaseSep); // flocking holds them apart
    expect(swarmSep).toBeGreaterThan(sep0 * 0.8); // didn't collapse into one point
    expect(chaseSep).toBeLessThan(sep0); // chasers converged
  });
});

describe('Swarmer — LUNGE (moving wind-up), distinct from the chaser telegraph', () => {
  it('moves DURING its telegraph; the chaser stands still during its telegraph', () => {
    // Swarmer: enters telegraph within lungeRange, then drifts at the player.
    const ss = arena();
    spawnEnemy(ss.enemies, 20 + ENEMY_TYPES.swarmer.lungeRange - 0.2, 20, 1, 'swarmer');
    const sw = ss.enemies.find((e) => e.active)!;
    updateEnemies(ss, DT); // chase -> telegraph (no move on the transition frame)
    expect(sw.phase).toBe('telegraph');
    const sx = sw.x;
    for (let k = 0; k < 5; k++) updateEnemies(ss, DT); // still within the 0.18s tell
    expect(Math.abs(sw.x - sx)).toBeGreaterThan(0.05); // MOVED during the wind-up

    // Chaser: enters telegraph and stays put.
    const cs = arena();
    spawnEnemy(cs.enemies, 20 + ENEMY_TYPES.chaser.attackRange * 0.5, 20, 1, 'chaser');
    const ch = cs.enemies.find((e) => e.active)!;
    updateEnemies(cs, DT); // chase -> telegraph
    expect(ch.phase).toBe('telegraph');
    const cx = ch.x;
    for (let k = 0; k < 5; k++) updateEnemies(cs, DT); // chaser telegraph is 0.55s
    expect(Math.abs(ch.x - cx)).toBeLessThan(1e-9); // stood still
  });
});

describe('Swarmer — fragile up close', () => {
  it('has less HP than the chaser and dies in fewer hits', () => {
    expect(ENEMY_TYPES.swarmer.maxHealth).toBeLessThan(ENEMY_TYPES.chaser.maxHealth);
    const hits = (type: EnemyType): number => {
      const s = arena();
      spawnEnemy(s.enemies, 22, 20, 1, type);
      const e = s.enemies.find((x) => x.active)!;
      let n = 0;
      while (e.active && n < 50) {
        damageEnemy(e, 13, 1, 0, 0, s); // a ranged-damage hit
        n++;
      }
      return n;
    };
    expect(hits('swarmer')).toBeLessThan(hits('chaser'));
  });
});

describe('Swarmer — light (KNOCKBACK launches it far)', () => {
  it('the same impulse launches a swarmer harder than a chaser', () => {
    const s = arena();
    spawnEnemy(s.enemies, 22, 20, 1, 'swarmer');
    spawnEnemy(s.enemies, 18, 20, 1, 'chaser');
    const sw = s.enemies.find((e) => e.active && e.type === 'swarmer')!;
    const ch = s.enemies.find((e) => e.active && e.type === 'chaser')!;
    const force = 7;
    damageEnemy(sw, 0, 1, 0, force, s); // amount 0 -> stays alive, just knockback
    damageEnemy(ch, 0, 1, 0, force, s);
    expect(sw.kbVx).toBeCloseTo(force * ENEMY_TYPES.swarmer.knockbackMult, 9);
    expect(ch.kbVx).toBeCloseTo(force * ENEMY_TYPES.chaser.knockbackMult, 9);
    expect(sw.kbVx).toBeGreaterThan(ch.kbVx);
  });
});

describe('Swarmer — 7c depth scaling applies', () => {
  it('a depth-5 swarmer is scaled by the difficulty curve', () => {
    const s = arena();
    spawnEnemy(s.enemies, 24, 20, 5, 'swarmer');
    const e = s.enemies.find((x) => x.active)!;
    const S = ENEMY_TYPES.swarmer;
    // healthMult/speedMult/damageMult at depth 5 are exercised by the ranged
    // suite; here just confirm swarmer rides the same path (scaled > base).
    expect(e.health).toBeGreaterThan(S.maxHealth);
    expect(e.moveSpeed).toBeGreaterThan(S.moveSpeed);
    expect(e.attackDamage).toBeGreaterThan(S.attackDamage);
  });
});

describe('Swarmer spawn mix — substitute, deterministic, depth-gated', () => {
  it('no swarmers below swarmerMinDepth; at least one at/after it', () => {
    expect(swarmerCountForDepth(1)).toBe(0);
    expect(swarmerCountForDepth(DIFFICULTY.swarmerMinDepth - 1)).toBe(0);
    expect(swarmerCountForDepth(DIFFICULTY.swarmerMinDepth)).toBeGreaterThanOrEqual(1);
  });

  it('always leaves at least one chaser across depths', () => {
    for (let d = 1; d <= 14; d++) {
      const specials = swarmerCountForDepth(d) + 0; // ranged handled in its own suite
      expect(specials).toBeLessThan(enemiesPerRoomForDepth(d)); // never all-swarmer
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

  it('spawned swarmer count matches the curve; substitute keeps the total + a chaser', () => {
    const depth = 6;
    const live = activateRoomEnemies(createGameState(), depth);
    const swarmers = live.filter((e) => e.type === 'swarmer').length;
    const chasers = live.filter((e) => e.type === 'chaser').length;
    expect(live.length).toBe(enemiesPerRoomForDepth(depth)); // substitute: total unchanged
    expect(swarmers).toBe(swarmerCountForDepth(depth));
    expect(swarmers).toBeGreaterThanOrEqual(1);
    expect(chasers).toBeGreaterThanOrEqual(1);
    expect(live[0].type).toBe('chaser'); // chasers-first: slot 0 stays a chaser
  });

  it('depth below swarmerMinDepth has no swarmers', () => {
    const live = activateRoomEnemies(createGameState(), DIFFICULTY.swarmerMinDepth - 1);
    expect(live.some((e) => e.type === 'swarmer')).toBe(false);
  });

  it('same seed + depth => identical type mix (deterministic)', () => {
    const a = activateRoomEnemies(createGameState(), 7);
    const b = activateRoomEnemies(createGameState(), 7);
    expect(a.map((e) => e.type)).toEqual(b.map((e) => e.type));
  });
});
