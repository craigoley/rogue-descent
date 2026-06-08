/**
 * META-progression persistence + the pure unlock rules (meta PR1). Mirrors Best.test's
 * localStorage-stub idiom (the node env has none). Pins:
 *   - round-trip: saveMeta → loadMeta is faithful.
 *   - graceful default: absent / corrupt / Safari-private storage → base default, no throw.
 *   - the pure unlock rule: beat the boss → 'freeze' unlocks (idempotent); newlyUnlocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRunResult, defaultMeta, loadMeta, newlyUnlocked, resetMeta, saveMeta } from '../Meta';

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
    expect(m.stats).toEqual({ deepestDepth: 0, bossKills: 0 });
    expect(m.runStart).toBeNull();
    expect(m.heat).toBe(0);
  });

  it('round-trips save → load', () => {
    installStorage();
    const m = { ...defaultMeta(), unlocked: ['freeze'], stats: { deepestDepth: 5, bossKills: 2 } };
    saveMeta(m);
    const back = loadMeta();
    expect(back.unlocked).toEqual(['freeze']);
    expect(back.stats).toEqual({ deepestDepth: 5, bossKills: 2 });
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
  it('beating the boss unlocks freeze + counts the kill; depth tracks the max', () => {
    const after = applyRunResult(defaultMeta(), { depth: 4, bossDefeated: true });
    expect(after.unlocked).toContain('freeze');
    expect(after.stats.bossKills).toBe(1);
    expect(after.stats.deepestDepth).toBe(4);
  });

  it('a run with NO boss kill unlocks nothing (but still tracks deepest depth)', () => {
    const after = applyRunResult(defaultMeta(), { depth: 2, bossDefeated: false });
    expect(after.unlocked).toEqual([]);
    expect(after.stats.deepestDepth).toBe(2);
  });

  it('is idempotent — re-beating the boss keeps freeze unlocked once', () => {
    const a = applyRunResult(defaultMeta(), { depth: 3, bossDefeated: true });
    const b = applyRunResult(a, { depth: 1, bossDefeated: true });
    expect(b.unlocked).toEqual(['freeze']); // not duplicated
    expect(b.stats.deepestDepth).toBe(3); // max preserved (didn't drop to 1)
  });

  it('newlyUnlocked reports the diff (for the run-end toast)', () => {
    const before = defaultMeta();
    const after = applyRunResult(before, { depth: 3, bossDefeated: true });
    expect(newlyUnlocked(before, after)).toEqual(['freeze']);
    // No new unlock the second time → empty diff.
    expect(newlyUnlocked(after, applyRunResult(after, { depth: 3, bossDefeated: true }))).toEqual([]);
  });
});
