import { describe, expect, it } from 'vitest';
import { createGameState, update, startNewRun, type GameState } from '../GameState';
import { createIntent } from '../Input';
import { bossDamageForDepth, bossGimmickForDepth, bossHpForDepth } from '../Difficulty';
import { attacksFor } from '../Boss';
import { BOSS, HEAT, SIM_DT } from '../../utils/constants';

const DT = SIM_DT;
const idle = createIntent;
const W = HEAT.unlockDepth; // the win-depth (8)

/** Mark every room cleared + the boss defeated + place/activate the stairs (mirrors the
 *  descent test helper): the player is parked at spawn so the stairs activate without
 *  the contact triggering a descend/win this frame. */
function clearFloor(s: GameState, lastIdx = 1): void {
  for (let i = 0; i < s.rooms.length; i++) s.rooms[i].phase = i === lastIdx ? 'active' : 'cleared';
  s.activeRoom = lastIdx;
  for (const c of s.rooms[lastIdx].doorCells) s.room.solid[c.ty * s.room.tilesX + c.tx] = true;
  s.bossDefeated = true;
  s.player.x = s.spawn.x;
  s.player.y = s.spawn.y;
  update(s, idle(), DT);
}

function standOnStairs(s: GameState): void {
  s.player.x = s.stairs.x;
  s.player.y = s.stairs.y;
}

describe('W=8 climax — the WIN state (the counterpart to death)', () => {
  it('beating the final boss at the win-depth W ENDS the run in VICTORY (capped, no descend)', () => {
    const s = createGameState();
    s.run.depth = W; // at the win-depth
    clearFloor(s); // final boss defeated + stairs placed
    standOnStairs(s);
    update(s, idle(), DT); // step on the stairs at W → WIN, do not descend
    expect(s.runWon).toBe(true);
    expect(s.runOver).toBe(false); // mutually exclusive
    expect(s.run.depth).toBe(W); // HARD CAP — never floor W+1
  });

  it('the won sim is FROZEN until restart (no further descent past W)', () => {
    const s = createGameState();
    s.run.depth = W;
    clearFloor(s);
    standOnStairs(s);
    update(s, idle(), DT);
    const depthAtWin = s.run.depth;
    update(s, idle(), DT); // another frame — frozen on runWon
    update(s, idle(), DT);
    expect(s.run.depth).toBe(depthAtWin);
    expect(s.runWon).toBe(true);
  });

  it('depths 1..W-1 still DESCEND normally (a non-final boss is not a win)', () => {
    const s = createGameState();
    s.run.depth = W - 1; // depth 7
    clearFloor(s);
    standOnStairs(s);
    update(s, idle(), DT); // step on stairs at W-1 → descend, NOT win
    expect(s.runWon).toBe(false);
    expect(s.run.depth).toBe(W); // descended into the final floor
  });

  it('death still works + stays mutually exclusive with victory', () => {
    const s = createGameState();
    s.player.alive = false;
    s.deathTimer = DT; // one frame of the death pause, then it elapses → runOver
    update(s, idle(), DT);
    expect(s.runOver).toBe(true);
    expect(s.runWon).toBe(false);
  });

  it('startNewRun clears both end-states', () => {
    const s = createGameState();
    s.runWon = true;
    s.runOver = true;
    startNewRun(s, 12345);
    expect(s.runWon).toBe(false);
    expect(s.runOver).toBe(false);
    expect(s.run.depth).toBe(1);
  });
});

describe('W=8 climax — the DISTINCT final boss carve-out (deterministic, pure)', () => {
  it("the win-depth boss is the 'final' gimmick (not the (depth-1)%3 rotation entry)", () => {
    expect(bossGimmickForDepth(W)).toBe('final');
  });

  it('every other depth keeps the rotation (W-1 and W+1 are NOT final)', () => {
    expect(bossGimmickForDepth(W - 1)).not.toBe('final');
    expect(bossGimmickForDepth(1)).toBe('positioning'); // depth-1 rotation entry, unchanged
  });

  it('the final boss is BEEFIER than the depth curve (the inverse of the depth-1 carve-out)', () => {
    expect(bossHpForDepth(W)).toBe(BOSS.finalHealth);
    expect(bossDamageForDepth(W)).toBe(BOSS.finalDamage);
    // distinguished: well above what the plain 7c curve would give at W
    expect(bossHpForDepth(W)).toBeGreaterThan(bossHpForDepth(W - 1));
  });

  it("'final' COMBINES the toolkit: cleave from phase 1, +summon at phase 2 (richer than any single gimmick)", () => {
    expect(attacksFor('final', false).length).toBe(2); // slam + cleave
    expect(attacksFor('final', true).length).toBe(3); // slam + summon + cleave
    // the combined phase-2 table is richer than the single-gimmick phase-2 tables
    expect(attacksFor('final', true).length).toBeGreaterThan(attacksFor('adds', true).length);
    expect(attacksFor('final', true).length).toBeGreaterThan(attacksFor('knockback', true).length);
  });
});
