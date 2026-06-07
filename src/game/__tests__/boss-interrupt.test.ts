/**
 * Boss gimmick #3 — KNOCKBACK-INTERRUPT (the last gimmick). Pins the contract:
 *   - A weak-side, knockback-track (knockbackLevel >= 1) melee hit during an
 *     INTERRUPTIBLE telegraph (CLEAVE) CANCELS the strike: phase -> recover, the
 *     strike's run() never fires (no player damage), and a SHIELD-DOWN stagger opens.
 *   - During the stagger, Combat.damageEnemy lets ARMORED-side hits land (free hits).
 *   - Off-telegraph hits, kbLevel-0 hits, and hits during a NON-interruptible
 *     telegraph (SLAM) do nothing — the gimmick is distinct + the windup is the gate.
 *   - FAIRNESS: an un-interrupted CLEAVE telegraph -> strike resolves and damages the
 *     player — it's a real, dodgeable attack, not a soft "must-interrupt" wall.
 *
 * Two responsibilities, tested separately: updateBoss CONSUMES boss.interruptHit
 * (the direct-signal tests), and Combat.meleeAttack SETS it (the end-to-end path).
 * Deterministic — the boss phase machine has no RNG. Reuses the boss.test idiom.
 */
import { describe, expect, it } from 'vitest';
import { createGameState, type GameState } from '../GameState';
import { spawnEnemy } from '../Enemy';
import { createBossState, updateBoss } from '../Boss';
import { damageEnemy, meleeAttack } from '../Combat';
import { BOSS, ENEMY_TYPES, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const SCRATCH = { x: 0, y: 0 };

type E = GameState['enemies'][number];

/** A boss spawned at (20,20), companion state at `depth`, pool otherwise empty. */
function withBoss(depth: number): { s: GameState; e: E } {
  const s = createGameState();
  for (const en of s.enemies) en.active = false;
  s.bossRoom = 1;
  spawnEnemy(s.enemies, 20, 20, depth, 'boss', s.bossRoom);
  const slot = s.enemies.findIndex((en) => en.active && en.type === 'boss');
  s.boss = createBossState(slot, depth);
  return { s, e: s.enemies[slot] };
}

/** Put the boss mid-telegraph for the attack at `cursor` of [SLAM, CLEAVE], full HP,
 *  with the player on the WEAK (+x) side inside CLEAVE reach (so an un-interrupted
 *  strike WOULD connect). depth 3 = the first knockback boss (two-phase), kept at
 *  full HP so it stays phase 1 (reach/timing un-amplified). */
function intoTelegraph(cursor: number): { s: GameState; e: E; boss: NonNullable<GameState['boss']> } {
  const { s, e } = withBoss(3);
  const boss = s.boss!;
  boss.gimmick = 'knockback';
  boss.attackCursor = cursor;
  boss.vulnerableAngle = 0; // weak-point faces +x (world)
  e.health = boss.maxHealth;
  e.phase = 'telegraph';
  e.timer = cursor === 1 ? BOSS.cleave.telegraph : ENEMY_TYPES.boss.telegraph;
  e.struck = false;
  s.player.x = e.x + 2.5; // +x weak side, within CLEAVE reach (~5.0) and melee reach
  s.player.y = e.y;
  return { s, e, boss };
}

/** Advance the boss one sim step with the real boss->player geometry. */
function step(s: GameState, e: E): void {
  const dx = s.player.x - e.x;
  const dy = s.player.y - e.y;
  updateBoss(e, s, DT, dx, dy, Math.hypot(dx, dy), SCRATCH);
}

describe('Boss gimmick #3 — interrupt (updateBoss consumes the signal)', () => {
  it('a weak-side knockback hit CANCELS the CLEAVE telegraph (strike skipped, stagger opens)', () => {
    const { s, e, boss } = intoTelegraph(1); // CLEAVE
    const playerHp = s.player.health;
    const bossHp = e.health;

    boss.interruptHit = true; // Combat's signal (a landed weak-side kb-track hit)
    step(s, e);

    expect(e.phase).toBe('recover'); // dropped out of the windup — strike skipped
    expect(boss.staggerTimer).toBeGreaterThan(0); // shield-down reward opened
    expect(boss.interruptHit).toBe(false); // one-frame signal consumed

    // Drive past the would-be strike window (well before any NEW cycle could strike:
    // recover 0.9 + telegraph 1.3 ≫ this): the player NEVER takes CLEAVE damage, and
    // the signal alone dealt the boss no damage.
    for (let i = 0; i < 30; i++) step(s, e);
    expect(s.player.health).toBe(playerHp);
    expect(e.health).toBe(bossHp);
  });

  it('STAGGER drops the shield: an armored-side hit LANDS while staggerTimer > 0', () => {
    const { s, e, boss } = intoTelegraph(1);
    boss.vulnerableAngle = 0; // weak faces +x; an armored hit comes with kbDir +x
    const hp = e.health;

    // Control: with no stagger, the armored-side hit is BLOCKED (no damage, false).
    expect(damageEnemy(e, 50, 1, 0, 0, s)).toBe(false);
    expect(e.health).toBe(hp);

    // Shield down: the SAME armored-side hit now lands full damage.
    boss.staggerTimer = 1;
    expect(damageEnemy(e, 50, 1, 0, 0, s)).toBe(true);
    expect(e.health).toBe(hp - 50);
  });

  it('a knockback hit OFF-telegraph (recover) does nothing — no cancel, no stagger', () => {
    const { s, e, boss } = intoTelegraph(1);
    e.phase = 'recover';
    e.timer = 0.5;
    boss.interruptHit = true;
    step(s, e);
    expect(e.phase).toBe('recover'); // unchanged path (just counting down)
    expect(boss.staggerTimer).toBe(0); // no reward window from an off-telegraph hit
  });

  it('SLAM telegraph is NOT interruptible — the signal is ignored (gimmick #3 is distinct)', () => {
    const { s, e, boss } = intoTelegraph(0); // SLAM (interruptible falsy)
    boss.interruptHit = true;
    step(s, e);
    expect(e.phase).toBe('telegraph'); // still winding up — not cancelled
    expect(boss.staggerTimer).toBe(0);
  });

  it('FAIRNESS: an un-interrupted CLEAVE telegraph -> strike RESOLVES and damages the player', () => {
    const { s, e } = intoTelegraph(1);
    const playerHp = s.player.health;
    // No interrupt: step through the full telegraph (1.3s) into the strike.
    for (let i = 0; i < 90; i++) step(s, e);
    expect(s.player.health).toBeLessThan(playerHp); // the attack is real + connects
  });
});

describe('Boss gimmick #3 — interrupt (Combat sets the signal)', () => {
  it('a weak-side melee hit with knockbackLevel >= 1 SETS interruptHit', () => {
    const { s, boss } = intoTelegraph(1);
    s.player.knockbackLevel = 1;
    meleeAttack(s, -1, 0); // aim toward the boss (player on +x, boss to -x)
    expect(boss.interruptHit).toBe(true);
  });

  it('knockbackLevel 0 (no powerup) does NOT interrupt — base force is not the gate', () => {
    const { s, boss } = intoTelegraph(1);
    s.player.knockbackLevel = 0;
    meleeAttack(s, -1, 0);
    expect(boss.interruptHit).toBe(false);
  });

  it('an ARMORED-side hit does NOT set the signal (blocked, not a weak-side landing)', () => {
    const { s, boss } = intoTelegraph(1);
    s.player.knockbackLevel = 2;
    boss.vulnerableAngle = Math.PI; // weak faces -x; the +x-side player hits armor
    meleeAttack(s, -1, 0);
    expect(boss.interruptHit).toBe(false);
  });
});
