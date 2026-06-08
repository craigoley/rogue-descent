/**
 * META PR1 — FREEZE (the 5th effect axis, UNLOCKABLE). Pins:
 *   MECHANIC: a direct hit at freezeLevel>=1 SLOWS the enemy (slowTimer + slowFactor),
 *     DISTINCT from stun (the enemy is NOT stunned — its AI still runs, it just moves
 *     slower); the slow expires; multishot/pierce apply it to N (rides the spine); a
 *     chain/tick hit does NOT freeze (direct-only, like lifesteal).
 *   ⭐ GATING: a run whose config.unlocked has 'freeze' offers it in the pool; the BASE
 *     config (locked) NEVER does — proving the meta config→pure-sim boundary. Base =
 *     today (the existing 326 are the regression proof).
 * Deterministic — config is a pure input; no rng in the freeze mechanic.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, update, type GameState, type RunConfig } from '../GameState';
import { createPlayer } from '../Player';
import { createIntent } from '../Input';
import { buildTestRoom, roomCenter } from '../Room';
import { spawnEnemy } from '../Enemy';
import { activeProjectileCount } from '../Projectile';
import { damageEnemy } from '../Combat';
import { chooseChestPicks, rollDrop, type PickupKind } from '../Pickup';
import { createRng } from '../../utils/rng';
import { FREEZE_LEVELS, POWERUP_MAX_LEVEL, SIM_DT } from '../../utils/constants';

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
function enemyAt(s: GameState, x: number, y: number) {
  spawnEnemy(s.enemies, x, y);
  const e = s.enemies.find((en) => en.active)!;
  e.health = 10_000;
  return e;
}

describe('Freeze — mechanic (slow, DISTINCT from stun)', () => {
  it('a direct hit at freezeLevel>=1 slows the enemy without stunning it', () => {
    const s = arena();
    s.player.freezeLevel = 2;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s); // direct
    expect(e.slowTimer).toBeCloseTo(FREEZE_LEVELS.duration, 5);
    expect(e.slowFactor).toBe(FREEZE_LEVELS.slowMult[2]);
    expect(e.stunTimer).toBe(0); // NOT stunned — it still acts (the key distinction)
  });

  it('level 0 = no freeze; a chain or tick hit does NOT freeze (direct-only)', () => {
    const s = arena();
    s.player.freezeLevel = 0;
    const e = enemyAt(s, s.player.x + 1, s.player.y);
    damageEnemy(e, 10, 1, 0, 0, s);
    expect(e.slowTimer).toBe(0); // level 0

    s.player.freezeLevel = 3;
    damageEnemy(e, 10, 1, 0, 0, s, 'chain');
    expect(e.slowTimer).toBe(0); // chain arc doesn't freeze
    damageEnemy(e, 10, 0, 0, 0, s, 'tick');
    expect(e.slowTimer).toBe(0); // a DoT tick doesn't freeze
  });

  it('a slowed chaser STILL MOVES toward the player (acts), but slower; the slow expires', () => {
    // Control: an un-slowed chaser closing on the player.
    const ctrl = arena();
    const ce = enemyAt(ctrl, ctrl.player.x + 5, ctrl.player.y);
    const cStart = ce.x;
    for (let i = 0; i < 20; i++) update(ctrl, createIntent(), DT);
    const ctrlMoved = cStart - ce.x; // moved left toward the player

    // Slowed: same setup, freeze applied.
    const slow = arena();
    const se = enemyAt(slow, slow.player.x + 5, slow.player.y);
    se.slowTimer = 10; // long enough to cover the window
    se.slowFactor = FREEZE_LEVELS.slowMult[3];
    const sStart = se.x;
    for (let i = 0; i < 20; i++) update(slow, createIntent(), DT);
    const slowMoved = sStart - se.x;

    expect(slowMoved).toBeGreaterThan(0); // it STILL moved (AI ran — not frozen)
    expect(slowMoved).toBeLessThan(ctrlMoved); // ...but slower than the control
    expect(se.slowTimer).toBeLessThan(10); // ticked down
  });

  it('a pierce shot freezes every enemy it passes through (rides the spine)', () => {
    const s = arena();
    s.player.freezeLevel = 2;
    s.player.facingX = 1;
    s.player.facingY = 0;
    s.player.pierceLevel = 3;
    const e1 = enemyAt(s, s.player.x + 2, s.player.y);
    const e2 = enemyAt(s, s.player.x + 4, s.player.y);
    update(s, { ...createIntent(), ranged: true }, DT);
    let guard = 0;
    while (activeProjectileCount(s.projectiles) > 0 && guard < 1000) {
      update(s, createIntent(), DT);
      guard++;
    }
    expect(e1.slowTimer).toBeGreaterThan(0);
    expect(e2.slowTimer).toBeGreaterThan(0);
  });
});

describe('Freeze — config gating (the meta boundary)', () => {
  const UNLOCKED: RunConfig = { unlocked: new Set(['freeze']), runStart: null };
  const BASE: RunConfig = { unlocked: new Set(), runStart: null };

  it('⭐ a chest offers freeze only when unlocked (base config never does)', () => {
    // Max every OTHER effect so freeze is the ONLY available effect — then the chest's
    // guaranteed-effect pick must be freeze IFF freeze is unlocked.
    const s = createGameState();
    s.player.lifestealLevel = POWERUP_MAX_LEVEL;
    s.player.burnLevel = POWERUP_MAX_LEVEL;
    s.player.chainLevel = POWERUP_MAX_LEVEL;
    s.player.critLevel = POWERUP_MAX_LEVEL;

    // Unlocked → freeze is the sole live effect → it's offered.
    const [a, b] = chooseChestPicks(s.player, createRng(1), UNLOCKED.unlocked);
    expect([a, b]).toContain('freeze');

    // Base (locked) → freeze absent → no effect available → 2 stat/health picks, no freeze.
    for (let seed = 0; seed < 30; seed++) {
      const picks = chooseChestPicks(s.player, createRng(seed), BASE.unlocked);
      expect(picks).not.toContain('freeze');
    }
  });

  it('⭐ floor drops include freeze only when unlocked; base never rolls it', () => {
    const seen = (unlocked: ReadonlySet<string>): Set<PickupKind> => {
      const out = new Set<PickupKind>();
      const rng = createRng(98765);
      for (let i = 0; i < 4000; i++) {
        const k = rollDrop(rng, unlocked);
        if (k) out.add(k);
      }
      return out;
    };
    expect(seen(BASE.unlocked).has('freeze')).toBe(false); // locked → never
    expect(seen(UNLOCKED.unlocked).has('freeze')).toBe(true); // unlocked → appears
  });

  it('a run created with the unlocked config carries it on state.config', () => {
    const s = createGameState(UNLOCKED);
    expect(s.config.unlocked.has('freeze')).toBe(true);
    const base = createGameState();
    expect(base.config.unlocked.has('freeze')).toBe(false); // default = base = locked
  });
});
