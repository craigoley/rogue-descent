/**
 * The BRUISER — the HEAVY archetype. L1 guards:
 *   - the Heavy STAT identity (slow / tanky / big reach, distinct from armored).
 *   - the SLAM: telegraph→strike→recover; damage ONLY in the strike window + within
 *     attackReach (NOT passive contact); a recover window exists.
 *   - ⭐ the LUNGE: committed at telegraph-start (fixed direction — dodge ACROSS it,
 *     not re-homing), deterministic.
 *   - SPAWN: base roster, depth-gated (>= bruiserMinDepth), HARD-capped 1/room even
 *     under Heat-Crowd; shallow roster byte-unchanged.
 *   - HEAT scales it like every type.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, regenerate, type GameState, type RunConfig } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import type { RoomState } from '../Room';
import { spawnEnemy, updateEnemies, type Enemy } from '../Enemy';
import { heatStatMults, NO_HEAT, type HeatConfig } from '../Heat';
import { ENEMY_TYPES, PLAYER_COMBAT, SIM_DT, ENCOUNTER } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;
const B = ENEMY_TYPES.bruiser;

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
/** Open arena, encounter system off, player at centre — AI in isolation. */
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
/** Step the bruiser AI until its phase changes (or a cap), returning the new phase. */
function stepUntilPhaseChange(s: GameState, e: Enemy, max = 120): string {
  const start = e.phase;
  for (let k = 0; k < max && e.phase === start; k++) updateEnemies(s, DT);
  return e.phase;
}

describe('Bruiser — the Heavy STAT identity', () => {
  it('is slow (< chaser), tankier than armored, with bigger reach + silhouette', () => {
    expect(B.moveSpeed).toBeLessThan(ENEMY_TYPES.chaser.moveSpeed); // SLOW
    expect(B.maxHealth).toBeGreaterThan(ENEMY_TYPES.armored.maxHealth); // tankier than armored
    expect(B.attackReach).toBeGreaterThan(ENEMY_TYPES.chaser.attackReach); // bigger slam
    expect(B.radius).toBeGreaterThan(ENEMY_TYPES.armored.radius); // biggest non-boss
    expect(B.attackDamage).toBeGreaterThan(ENEMY_TYPES.chaser.attackDamage); // hits harder
  });
});

describe('Bruiser — the SLAM (telegraph → strike → recover)', () => {
  it('does NOT damage on contact during the wind-up — only the strike frame, in reach', () => {
    const s = arena();
    spawnEnemy(s.enemies, s.player.x + 1.0, s.player.y, 1, 'bruiser'); // within range + reach
    const e = s.enemies.find((x) => x.active)!;
    const hp0 = s.player.health;

    updateEnemies(s, DT); // chase → telegraph (in range)
    expect(e.phase).toBe('telegraph');
    // Stand in reach through the WHOLE wind-up: NO damage (not passive contact).
    for (let k = 0; k < 30; k++) {
      updateEnemies(s, DT);
      if (e.phase !== 'telegraph') break;
    }
    expect(s.player.health).toBe(hp0); // untouched during the telegraph

    // The slam lands once it reaches the strike phase.
    stepUntilPhaseChange(s, e); // → strike (if not already)
    for (let k = 0; k < 10 && s.player.health === hp0; k++) updateEnemies(s, DT);
    expect(s.player.health).toBe(hp0 - e.attackDamage); // exactly one slam, by attackDamage
  });

  it('cycles telegraph → strike → recover (the recover punish window exists)', () => {
    const s = arena();
    spawnEnemy(s.enemies, s.player.x + 1.0, s.player.y, 1, 'bruiser');
    const e = s.enemies.find((x) => x.active)!;
    updateEnemies(s, DT);
    expect(e.phase).toBe('telegraph');
    expect(stepUntilPhaseChange(s, e)).toBe('strike');
    expect(stepUntilPhaseChange(s, e)).toBe('recover'); // the vulnerable window
    expect(stepUntilPhaseChange(s, e)).toBe('chase'); // back to chasing
  });
});

describe('Bruiser — the committed LUNGE (dodge ACROSS, not re-homing)', () => {
  it('captures the lunge direction at telegraph-start and holds it (you sidestep the leap)', () => {
    const s = arena();
    spawnEnemy(s.enemies, s.player.x + 1.5, s.player.y, 1, 'bruiser'); // on the +x axis
    const e = s.enemies.find((x) => x.active)!;
    const hp0 = s.player.health;

    updateEnemies(s, DT); // → telegraph, lunge dir committed toward the player (-x)
    expect(e.phase).toBe('telegraph');
    expect(e.lungeDirX).toBeLessThan(0); // toward the player (which is at -x)
    expect(Math.abs(e.lungeDirY)).toBeLessThan(1e-9);

    // DODGE ACROSS: step the player perpendicular, OFF the committed lunge line.
    s.player.y = s.spawn.y + 4;
    for (let k = 0; k < 70; k++) updateEnemies(s, DT); // through telegraph + strike + recover
    // The lunge fired along the ORIGINAL direction (committed, NOT re-homed at the new
    // +y player), so it whiffed → no damage; and the dir vector is unchanged.
    expect(s.player.health).toBe(hp0); // dodged across the leap
    expect(Math.abs(e.lungeDirY)).toBeLessThan(1e-9); // never re-homed toward the moved player
  });

  it('the lunge MOVES the bruiser forward (a leap) and is deterministic', () => {
    const run = (): { dirX: number; x: number; y: number } => {
      const s = arena();
      spawnEnemy(s.enemies, s.player.x + 1.6, s.player.y + 0.2, 1, 'bruiser');
      const e = s.enemies.find((x) => x.active)!;
      for (let k = 0; k < 60; k++) updateEnemies(s, DT); // telegraph → lunge
      return { dirX: e.lungeDirX, x: e.x, y: e.y };
    };
    const a = run();
    expect(a.dirX).toBeLessThan(0); // committed toward the player
    const b = run();
    expect(b).toEqual(a); // same seed/path → identical lunge vector + end position
  });
});

describe('Bruiser — spawn gate (base roster, depth-gated, 1/room cap)', () => {
  const cfg = (heat: HeatConfig): RunConfig => ({ unlocked: new Set<string>(), runStart: null, heat });
  function bruisersAtDepth(depth: number, heat: HeatConfig = NO_HEAT): number {
    const s = createGameState(cfg(heat));
    s.run.depth = depth;
    regenerate(s, s.seed);
    const i = s.rooms.findIndex((r) => r.phase === 'idle' && r.spawns.length > 0);
    const r = s.rooms[i].rect;
    s.player.x = (r.x + r.w / 2) * s.room.tileSize;
    s.player.y = (r.y + r.h / 2) * s.room.tileSize;
    update(s, idle(), DT);
    return s.enemies.filter((e) => e.active && e.type === 'bruiser').length;
  }

  it('does NOT spawn below bruiserMinDepth (the shallow roster is unchanged)', () => {
    expect(bruisersAtDepth(ENCOUNTER.bruiserMinDepth - 1)).toBe(0);
  });

  it('spawns at bruiserMinDepth, HARD-capped at 1/room — even under Heat-Crowd', () => {
    expect(bruisersAtDepth(ENCOUNTER.bruiserMinDepth)).toBe(ENCOUNTER.bruiserPerRoom);
    // Heat-Crowd inflates the room count, but the cap holds: never more than 1 Heavy.
    const crowd = bruisersAtDepth(ENCOUNTER.bruiserMinDepth, { ...NO_HEAT, crowd: 2 });
    expect(crowd).toBeLessThanOrEqual(ENCOUNTER.bruiserPerRoom);
  });
});

describe('Bruiser — Heat scales it like every type', () => {
  it('Hard Labor / Thick Skin / Swift Death raise its slam dmg / HP / speed', () => {
    const base = arena();
    spawnEnemy(base.enemies, 25, 20, 1, 'bruiser');
    const be = base.enemies.find((e) => e.active)!;

    const hot = arena();
    const m = heatStatMults({ hardLabor: 3, swiftDeath: 3, thickSkin: 3, crowd: 0 });
    spawnEnemy(hot.enemies, 25, 20, 1, 'bruiser', -1, m);
    const he = hot.enemies.find((e) => e.active)!;

    expect(he.health).toBeGreaterThan(be.health);
    expect(he.attackDamage).toBeGreaterThan(be.attackDamage); // Hard Labor → slam dmg
    expect(he.moveSpeed).toBeGreaterThan(be.moveSpeed);
    void PLAYER_COMBAT; // (player untouched — the power-neutral invariant lives in heat.test)
  });
});
