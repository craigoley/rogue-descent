/**
 * SYNERGY ARC — PR3 CHAIN (a direct hit arcs to nearby enemies). The degenerate-risk
 * axis, so its BOUNDS are the headline of this suite:
 *   - ⭐ JUMP CAP: a hit chains to at most maxJumps[level] enemies — never more.
 *   - FALLOFF: each hop deals strictly less (×falloff).
 *   - DEDUPE: a 2-enemy setup hits the other once, never ping-pongs (no A→B→A).
 *   - NO RE-CHAIN: total damaged = 1 direct + ≤maxJumps, NOT exponential (the 'chain'
 *     hit-kind can't re-trigger chainFrom — enforced by the type).
 *   - chain × burn = WILDFIRE: arcs carry burn-ignite to jumped enemies.
 *   - NO per-jump lifesteal: only the direct hit heals (arcs don't).
 *   - chain-KILL counts + drops (like the burn-tick path).
 *   - level 0 = no chain.
 * Deterministic — nearest-search is pure geometry (ties by pool index), no RNG.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import { buildTestRoom, roomCenter } from '../Room';
import { spawnEnemy, roomEnemyCount } from '../Enemy';
import { activePickupCount } from '../Pickup';
import { damageEnemy } from '../Combat';
import { CHAIN_LEVELS, LIFESTEAL_LEVELS, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;

function arena(): GameState {
  const s = createGameState();
  s.room = buildTestRoom();
  const c = roomCenter(s.room);
  s.spawn = { x: c.x, y: c.y };
  s.player = createPlayer(c.x, c.y);
  for (const e of s.enemies) e.active = false;
  s.rooms = [];
  s.activeRoom = -1;
  return s;
}

/** Spawn n enemies at the given offsets from (bx,by), each with `hp`. Returns them
 *  in spawn order (= pool order). */
function cluster(s: GameState, bx: number, by: number, offsets: Array<[number, number]>, hp = 1000) {
  const list = [];
  for (const [ox, oy] of offsets) {
    spawnEnemy(s.enemies, bx + ox, by + oy);
    const e = s.enemies.filter((en) => en.active).at(-1)!;
    e.health = hp;
    list.push(e);
  }
  return list;
}

const damaged = (e: { health: number }, hp = 1000) => e.health < hp;

describe('Chain — JUMP CAP (the headline bound)', () => {
  // origin + 4 others, all tightly clustered within CHAIN range of each other.
  const offsets: Array<[number, number]> = [
    [0, 0], // origin (takes the direct hit)
    [0.6, 0],
    [1.2, 0],
    [0, 0.6],
    [0.6, 0.6],
  ];

  it('level III chains to AT MOST 3 others (never more), with 4 in range', () => {
    const s = arena();
    s.player.chainLevel = 3;
    const [origin, ...others] = cluster(s, 20, 20, offsets);
    damageEnemy(origin, 100, 1, 0, 0, s); // one direct hit → triggers the chain
    const hit = others.filter((e) => damaged(e)).length;
    expect(hit).toBe(3); // exactly maxJumps[3], not all 4 → cap holds
  });

  it('levels 1 and 2 cap at 1 and 2 jumps', () => {
    for (const [lvl, cap] of [[1, 1], [2, 2]] as const) {
      const s = arena();
      s.player.chainLevel = lvl;
      const [origin, ...others] = cluster(s, 20, 20, offsets);
      damageEnemy(origin, 100, 1, 0, 0, s);
      expect(others.filter((e) => damaged(e)).length).toBe(cap);
    }
  });

  it('level 0 = no chain', () => {
    const s = arena();
    s.player.chainLevel = 0;
    const [origin, ...others] = cluster(s, 20, 20, offsets);
    damageEnemy(origin, 100, 1, 0, 0, s);
    expect(others.some((e) => damaged(e))).toBe(false);
  });
});

describe('Chain — falloff + dedupe + no-cascade', () => {
  it('damage falls off strictly per hop', () => {
    const s = arena();
    s.player.chainLevel = 3;
    // A line so the nearest-search order is unambiguous: origin → e1 → e2 → e3.
    const [origin, e1, e2, e3] = cluster(s, 20, 20, [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    damageEnemy(origin, 100, 1, 0, 0, s);
    const d1 = 1000 - e1.health;
    const d2 = 1000 - e2.health;
    const d3 = 1000 - e3.health;
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThan(d3);
    expect(d1).toBeCloseTo(100 * CHAIN_LEVELS.falloff, 5); // first hop = base × falloff
  });

  it('DEDUPE: a 2-enemy setup hits the other exactly once (no ping-pong)', () => {
    const s = arena();
    s.player.chainLevel = 3; // 3 jumps available, but only 1 other enemy exists
    const [origin, other] = cluster(s, 20, 20, [
      [0, 0],
      [1, 0],
    ]);
    damageEnemy(origin, 100, 1, 0, 0, s);
    // Exactly ONE chain hit (base×falloff); never re-hit despite 3 jumps available.
    expect(1000 - other.health).toBeCloseTo(100 * CHAIN_LEVELS.falloff, 5);
  });

  it('NO RE-CHAIN: total damaged = 1 direct + maxJumps, not exponential', () => {
    const s = arena();
    s.player.chainLevel = 3;
    // 6 in a line: a cascade would light all of them; the cap stops at origin + 3.
    const all = cluster(s, 20, 20, [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    damageEnemy(all[0], 100, 1, 0, 0, s);
    const hit = all.filter((e) => damaged(e)).length;
    expect(hit).toBe(4); // origin + exactly 3 jumps; e4/e5 untouched (no cascade)
  });
});

describe('Chain — synergy', () => {
  it('chain × burn = WILDFIRE: arcs ignite the jumped enemies', () => {
    const s = arena();
    s.player.chainLevel = 3;
    s.player.burnLevel = 2;
    const [origin, ...others] = cluster(s, 20, 20, [
      [0, 0],
      [0.6, 0],
      [1.2, 0],
      [0, 0.6],
    ]);
    damageEnemy(origin, 100, 1, 0, 0, s);
    const lit = others.filter((e) => e.burnTimer > 0).length;
    expect(lit).toBe(3); // every chained enemy caught fire
  });

  it('NO per-jump lifesteal: only the direct hit heals (arcs do not)', () => {
    const s = arena();
    s.player.chainLevel = 3;
    s.player.lifestealLevel = 3;
    s.player.health = 50;
    const [origin] = cluster(s, 20, 20, [
      [0, 0],
      [0.6, 0],
      [1.2, 0],
      [0, 0.6],
    ]);
    damageEnemy(origin, 100, 1, 0, 0, s);
    // Heal = exactly ONE direct hit's lifesteal (capped), NOT 1 + 3 arcs.
    const expected = Math.min(100 * LIFESTEAL_LEVELS.frac[3], LIFESTEAL_LEVELS.maxPerHit);
    expect(s.player.health - 50).toBeCloseTo(expected, 5);
  });
});

describe('Chain — the chain-kill path (counts + drops, like burn-tick)', () => {
  it('an arc that kills counts as a kill and rolls a drop', () => {
    const s = createGameState(); // real dungeon (encounter + death-diff live)
    for (const e of s.enemies) e.active = false;
    const ri = 1;
    const r = s.rooms[ri].rect;
    const ts = s.room.tileSize;
    const cx = (r.x + r.w / 2) * ts;
    const cy = (r.y + r.h / 2) * ts;
    s.rooms[ri].phase = 'active';
    s.activeRoom = ri;
    // Player at the room centre; a tanky origin in melee reach; a FRAGILE neighbour
    // OUT of melee reach (~2.05) but within CHAIN range (4) of the origin — so ONLY a
    // chain arc (not the direct swing) can reach + kill it (isolates the chain kill).
    s.player.x = cx;
    s.player.y = cy;
    s.player.facingX = 1;
    s.player.facingY = 0;
    s.player.chainLevel = 3;
    spawnEnemy(s.enemies, cx + 1.5, cy, 1, 'chaser', ri); // melee range
    spawnEnemy(s.enemies, cx + 4, cy, 1, 'chaser', ri); // out of melee, in chain range of origin
    const [origin, neighbour] = s.enemies.filter((e) => e.active);
    origin.health = 10_000; // survives the melee hit
    neighbour.health = 2; // dies to the first arc

    s.player.health = 10; // hurt → a rolled health drop isn't suppressed
    s.dropRng = { next: () => 0, int: () => 0 }; // → a guaranteed health drop

    const kills0 = s.run.kills;
    const picks0 = activePickupCount(s.pickups);
    update(s, { ...createIntent(), melee: true }, DT); // melee origin → chain kills neighbour

    expect(neighbour.active).toBe(false); // killed by the arc
    expect(s.run.kills).toBe(kills0 + 1); // the death-diff observed the chain kill
    expect(activePickupCount(s.pickups)).toBe(picks0 + 1); // ...and rolled a drop
    expect(roomEnemyCount(s.enemies, ri)).toBe(1); // origin still alive; neighbour cleared
  });
});
