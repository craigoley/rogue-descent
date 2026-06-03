import { afterEach, describe, expect, it, vi } from 'vitest';
import { betterBest, loadBest, recordRunDepth, NO_BEST } from '../Best';

/** Minimal in-memory localStorage stub (the test env is Node — no real one). */
function installStorage(): void {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string): string | null => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string): void => void m.set(k, String(v)),
    removeItem: (k: string): void => void m.delete(k),
    clear: (): void => m.clear(),
  });
}

/** A localStorage whose every method throws (Safari Private Mode style). */
function installThrowingStorage(): void {
  const boom = (): never => {
    throw new Error('storage disabled');
  };
  vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom, clear: boom });
}

afterEach(() => vi.unstubAllGlobals());

describe('betterBest (pure)', () => {
  it('takes the higher depth', () => {
    expect(betterBest({ depth: 3 }, 5)).toEqual({ depth: 5 });
  });
  it('keeps the existing best when the run is shallower or equal', () => {
    expect(betterBest({ depth: 5 }, 3)).toEqual({ depth: 5 });
    expect(betterBest({ depth: 5 }, 5)).toEqual({ depth: 5 });
  });
});

describe('recordRunDepth (persisted)', () => {
  it('a higher depth updates the stored best; a lower one does not', () => {
    installStorage();
    expect(loadBest()).toEqual(NO_BEST); // empty store
    expect(recordRunDepth(5).depth).toBe(5);
    expect(loadBest().depth).toBe(5); // persisted
    expect(recordRunDepth(3).depth).toBe(5); // shallower -> unchanged
    expect(loadBest().depth).toBe(5); // still 5
    expect(recordRunDepth(8).depth).toBe(8); // deeper -> updated
    expect(loadBest().depth).toBe(8);
  });
});

describe('storage-unavailable safety (never breaks the run loop)', () => {
  it('loadBest returns the zero best and does not throw', () => {
    installThrowingStorage();
    expect(() => loadBest()).not.toThrow();
    expect(loadBest()).toEqual(NO_BEST);
  });
  it('recordRunDepth still returns the computed best and does not throw', () => {
    installThrowingStorage();
    expect(() => recordRunDepth(5)).not.toThrow();
    expect(recordRunDepth(5).depth).toBe(5); // in-memory best, just not persisted
  });
});
