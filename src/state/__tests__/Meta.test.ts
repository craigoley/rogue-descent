/**
 * META-progression persistence + the pure unlock rules (meta PR1). Mirrors Best.test's
 * localStorage-stub idiom (the node env has none). Pins:
 *   - round-trip: saveMeta → loadMeta is faithful.
 *   - graceful default: absent / corrupt / Safari-private storage → base default, no throw.
 *   - the pure unlock rule: beat the boss → 'freeze' unlocks (idempotent); newlyUnlocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRunResult, defaultMeta, loadMeta, newlyUnlocked, resetMeta, saveMeta, shouldOfferHeat, shouldOfferLean, unlockProgress, UNLOCKS } from '../Meta';
import { HEAT } from '../../utils/constants';

/** Minimal in-memory localStorage stub (node env has none). */
function installStorage(): Map<string, string> {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string): string | null => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string): void => void m.set(k, String(v)),
    removeItem: (k: string): void => void m.delete(k),
    clear: (): void => m.clear(),
  });
  return m;
}
function installThrowingStorage(): void {
  const boom = (): never => {
    throw new Error('storage disabled');
  };
  vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom, clear: boom });
}
afterEach(() => vi.unstubAllGlobals());

describe('Meta — persistence', () => {
  it('defaults to a clean slate when storage is empty', () => {
    installStorage();
    const m = loadMeta();
    expect(m.unlocked).toEqual([]);
    expect(m.stats).toEqual({ deepestDepth: 0, bossKills: 0, wildfireKills: 0, highestHeatWin: 0 });
    expect(m.runStart).toBeNull();
    expect(m.heat).toEqual({ hardLabor: 0, swiftDeath: 0, thickSkin: 0, crowd: 0 });
  });

  it('round-trips save → load', () => {
    installStorage();
    const m = { ...defaultMeta(), unlocked: ['freeze'], stats: { deepestDepth: 5, bossKills: 2, wildfireKills: 12, highestHeatWin: 0 } };
    saveMeta(m);
    const back = loadMeta();
    expect(back.unlocked).toEqual(['freeze']);
    expect(back.stats).toEqual({ deepestDepth: 5, bossKills: 2, wildfireKills: 12, highestHeatWin: 0 });
  });

  it('corrupt JSON → base default (never throws)', () => {
    const store = installStorage();
    store.set('rogue-descent:meta', '{ this is not json');
    expect(loadMeta()).toEqual(defaultMeta());
  });

  it('Safari-private storage → base default; save never throws', () => {
    installThrowingStorage();
    expect(loadMeta()).toEqual(defaultMeta());
    expect(() => saveMeta(defaultMeta())).not.toThrow();
  });

  it('reset clears progress to the default', () => {
    installStorage();
    saveMeta({ ...defaultMeta(), unlocked: ['freeze'] });
    const fresh = resetMeta();
    expect(fresh).toEqual(defaultMeta());
    expect(loadMeta().unlocked).toEqual([]);
  });
});

describe('Meta — unlock rules (pure, no I/O)', () => {
  // Depths are kept BELOW the armored-chaser threshold (3) where a test isolates the
  // boss→freeze rule, so the depth-3 milestone doesn't muddy the assertion.
  it('beating the boss unlocks freeze + counts the kill; depth tracks the max', () => {
    const after = applyRunResult(defaultMeta(), { depth: 1, bossDefeated: true, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    expect(after.unlocked).toContain('freeze');
    expect(after.unlocked).not.toContain('armored-chaser'); // depth 1 < 3
    expect(after.stats.bossKills).toBe(1);
    expect(after.stats.deepestDepth).toBe(1);
  });

  it('hasWon: false by default, set true ONLY on a win (won), then monotonic; a death-at-8 does NOT set it', () => {
    expect(defaultMeta().hasWon).toBe(false);
    // reaching/dying at the win-depth without winning does not set hasWon
    const died = applyRunResult(defaultMeta(), { depth: 8, bossDefeated: false, wildfireKills: 0, heat: 3, reachedWinDepth: true });
    expect(died.hasWon).toBe(false);
    // a true WIN sets it
    const won = applyRunResult(defaultMeta(), { depth: 8, bossDefeated: true, wildfireKills: 0, heat: 3, reachedWinDepth: true, won: true });
    expect(won.hasWon).toBe(true);
    // monotonic: a later non-win run keeps hasWon
    const after = applyRunResult(won, { depth: 2, bossDefeated: false, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    expect(after.hasWon).toBe(true);
  });

  it('a run with NO boss kill (shallow, no wildfire) unlocks nothing', () => {
    const after = applyRunResult(defaultMeta(), { depth: 2, bossDefeated: false, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    expect(after.unlocked).toEqual([]);
    expect(after.stats.deepestDepth).toBe(2);
  });

  it('is idempotent — re-beating the boss keeps freeze unlocked once', () => {
    const a = applyRunResult(defaultMeta(), { depth: 1, bossDefeated: true, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    const b = applyRunResult(a, { depth: 1, bossDefeated: true, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    expect(b.unlocked).toEqual(['freeze']); // not duplicated
    expect(b.stats.bossKills).toBe(2); // still counted
  });

  it('newlyUnlocked reports the diff (for the run-end toast)', () => {
    const before = defaultMeta();
    const after = applyRunResult(before, { depth: 1, bossDefeated: true, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    expect(newlyUnlocked(before, after)).toEqual(['freeze']);
    // No new unlock the second time → empty diff.
    expect(newlyUnlocked(after, applyRunResult(after, { depth: 1, bossDefeated: true, wildfireKills: 0, heat: 0, reachedWinDepth: false }))).toEqual([]);
  });
});

describe('Meta — PR2 milestones (enemy + track dimensions)', () => {
  it('⭐ reaching depth 3 (cumulative) unlocks the ARMORED CHASER; depth 2 does not', () => {
    expect(applyRunResult(defaultMeta(), { depth: 2, bossDefeated: false, wildfireKills: 0, heat: 0, reachedWinDepth: false }).unlocked).not.toContain(
      'armored-chaser',
    );
    expect(applyRunResult(defaultMeta(), { depth: 3, bossDefeated: false, wildfireKills: 0, heat: 0, reachedWinDepth: false }).unlocked).toContain(
      'armored-chaser',
    );
    // Cumulative: a later SHALLOW run keeps it (deepestDepth is the max).
    const deep = applyRunResult(defaultMeta(), { depth: 3, bossDefeated: false, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    expect(applyRunResult(deep, { depth: 1, bossDefeated: false, wildfireKills: 0, heat: 0, reachedWinDepth: false }).unlocked).toContain('armored-chaser');
  });

  it('⭐ 30 CUMULATIVE wildfire kills unlocks FIRE RATE — accrued across runs, not one lucky run', () => {
    // 29 in a single run → not yet.
    const r1 = applyRunResult(defaultMeta(), { depth: 1, bossDefeated: false, wildfireKills: 29, heat: 0, reachedWinDepth: false });
    expect(r1.stats.wildfireKills).toBe(29);
    expect(r1.unlocked).not.toContain('fireRate');
    // +1 next run → crosses 30 cumulatively → unlocked.
    const r2 = applyRunResult(r1, { depth: 1, bossDefeated: false, wildfireKills: 1, heat: 0, reachedWinDepth: false });
    expect(r2.stats.wildfireKills).toBe(30);
    expect(r2.unlocked).toContain('fireRate');
  });

  it('the milestone fn maps a full stats set → the correct unlock set', () => {
    // Boss + depth 5 + 40 wildfire → all three dimensions unlocked.
    const all = applyRunResult(defaultMeta(), { depth: 5, bossDefeated: true, wildfireKills: 40, heat: 0, reachedWinDepth: false });
    expect([...all.unlocked].sort()).toEqual(['armored-chaser', 'fireRate', 'freeze']);
    // Nothing achieved → empty.
    const none = applyRunResult(defaultMeta(), { depth: 1, bossDefeated: false, wildfireKills: 0, heat: 0, reachedWinDepth: false });
    expect(none.unlocked).toEqual([]);
  });

  it('the catalog covers all three dimensions (one entry per unlockable)', () => {
    expect(UNLOCKS.map((u) => u.id).sort()).toEqual(['armored-chaser', 'fireRate', 'fireRate', 'freeze']); // fireRate has 2 paths (milestone + Heat)
  });
});

describe('Meta — unlockProgress (the surface helper, pure)', () => {
  const byId = (rows: ReturnType<typeof unlockProgress>, id: string) => rows.find((r) => r.id === id)!;

  it('base meta → everything LOCKED, current 0, correct targets', () => {
    const rows = unlockProgress(defaultMeta());
    expect(rows.every((r) => !r.unlocked)).toBe(true);
    expect(rows.every((r) => r.current === 0)).toBe(true);
    expect(byId(rows, 'freeze').target).toBe(1);
    expect(byId(rows, 'armored-chaser').target).toBe(3);
    expect(byId(rows, 'fireRate').target).toBe(30);
    expect(byId(rows, 'freeze').binary).toBe(true);
    expect(byId(rows, 'fireRate').binary).toBe(false);
    // Each row carries its label + description + hint (the catalog copy).
    expect(byId(rows, 'fireRate').label).toBe('Fire Rate');
    expect(byId(rows, 'armored-chaser').hint).toMatch(/depth 3/i);
  });

  it('partial progress → in-progress counts shown, still locked', () => {
    // deepestDepth 2, wildfire 12, no boss — and nothing persisted as unlocked.
    const meta = { ...defaultMeta(), stats: { deepestDepth: 2, bossKills: 0, wildfireKills: 12, highestHeatWin: 0 } };
    const rows = unlockProgress(meta);
    expect(byId(rows, 'armored-chaser')).toMatchObject({ unlocked: false, current: 2, target: 3 });
    expect(byId(rows, 'fireRate')).toMatchObject({ unlocked: false, current: 12, target: 30 });
    expect(byId(rows, 'freeze')).toMatchObject({ unlocked: false, current: 0, target: 1 });
  });

  it('reflects the PERSISTED unlocked set (✓ for earned ones)', () => {
    // A real run-end meta: beat boss + depth 5 + 40 wildfire → all unlocked.
    const meta = applyRunResult(defaultMeta(), { depth: 5, bossDefeated: true, wildfireKills: 40, heat: 0, reachedWinDepth: false });
    expect(unlockProgress(meta).every((r) => r.unlocked)).toBe(true);
  });

  it('current CLAMPS to target (a counted bar never overshoots)', () => {
    const meta = { ...defaultMeta(), stats: { deepestDepth: 9, bossKills: 4, wildfireKills: 45, highestHeatWin: 0 } };
    const rows = unlockProgress(meta);
    expect(byId(rows, 'fireRate').current).toBe(30); // 45 clamped to 30
    expect(byId(rows, 'armored-chaser').current).toBe(3); // 9 clamped to 3
    expect(byId(rows, 'freeze').current).toBe(1); // 4 clamped to 1
  });
});

describe('Meta — shouldOfferLean (the L2 run-start card gate, pure)', () => {
  it('a fresh save (nothing unlocked) SUPPRESSES the lean card → today exactly', () => {
    expect(shouldOfferLean(defaultMeta())).toBe(false);
  });

  it('once ANYTHING is unlocked, the lean ritual appears', () => {
    expect(shouldOfferLean({ ...defaultMeta(), unlocked: ['freeze'] })).toBe(true);
  });
});

describe('Meta — L3 HEAT (the reward + the post-win gate, pure)', () => {
  const win = (heat: number, reached: boolean) => ({
    depth: reached ? HEAT.unlockDepth : 1,
    bossDefeated: false,
    wildfireKills: 0,
    heat,
    reachedWinDepth: reached,
  });

  it('a WIN (reached W) records the Heat it was won at; a non-win records nothing', () => {
    const a = applyRunResult(defaultMeta(), win(5, true));
    expect(a.stats.highestHeatWin).toBe(5); // reached W at Heat 5 → recorded
    const b = applyRunResult(defaultMeta(), win(9, false));
    expect(b.stats.highestHeatWin).toBe(0); // did NOT reach W → nothing, even at high Heat
    const c = applyRunResult(a, win(2, true));
    expect(c.stats.highestHeatWin).toBe(5); // monotonic max — a lower-heat win never lowers it
  });

  it('fireRate unlocks via the HEAT path at highestHeatWin >= the threshold (the L3→L1 loop)', () => {
    const below = applyRunResult(defaultMeta(), win(HEAT.fireRateRewardHeat - 1, true));
    expect(below.unlocked).not.toContain('fireRate'); // not yet (and no wildfire kills)
    const at = applyRunResult(defaultMeta(), win(HEAT.fireRateRewardHeat, true));
    expect(at.unlocked).toContain('fireRate'); // the Heat win unlocked it (alternate path)
  });

  it('shouldOfferHeat is SUPPRESSED until the first win (deepestDepth >= W)', () => {
    expect(shouldOfferHeat(defaultMeta())).toBe(false); // fresh → no Heat card
    const stats = (d: number) => ({ ...defaultMeta(), stats: { ...defaultMeta().stats, deepestDepth: d } });
    expect(shouldOfferHeat(stats(HEAT.unlockDepth - 1))).toBe(false);
    expect(shouldOfferHeat(stats(HEAT.unlockDepth))).toBe(true);
  });
});
