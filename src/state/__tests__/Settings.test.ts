/**
 * Settings persistence — pins the load/save round-trip + back-compat defaulting for
 * the accessibility `reduceMotion` flag (PR2 juice). The render layer (HUD vignette +
 * main.ts shake) keys off this value, so its persistence + safe-degrade behaviour is
 * the contract worth guarding. Mirrors the Best.test localStorage-stub idiom (the test
 * env is Node — no real localStorage).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../Settings';

/** Minimal in-memory localStorage stub (Node env has none). */
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

/** A localStorage whose every method throws (Safari Private Mode style). */
function installThrowingStorage(): void {
  const boom = (): never => {
    throw new Error('storage disabled');
  };
  vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom, clear: boom });
}

afterEach(() => vi.unstubAllGlobals());

describe('Settings persistence', () => {
  it('defaults reduceMotion (and muted) to false on an empty store', () => {
    installStorage();
    expect(loadSettings()).toEqual({ muted: false, reduceMotion: false });
    expect(DEFAULT_SETTINGS.reduceMotion).toBe(false);
  });

  it('round-trips reduceMotion through save -> load', () => {
    installStorage();
    saveSettings({ muted: false, reduceMotion: true });
    expect(loadSettings().reduceMotion).toBe(true);
    saveSettings({ muted: false, reduceMotion: false });
    expect(loadSettings().reduceMotion).toBe(false);
  });

  it('toggles reduceMotion independently of muted', () => {
    installStorage();
    saveSettings({ muted: true, reduceMotion: true });
    const s = loadSettings();
    expect(s.muted).toBe(true);
    expect(s.reduceMotion).toBe(true);
  });

  it('back-compat: a pre-PR2 record with only {muted} loads reduceMotion as the default', () => {
    const store = installStorage();
    // Simulate a save from before reduceMotion existed (only `muted` persisted).
    store.set('rogue-descent:settings', JSON.stringify({ muted: true }));
    const s = loadSettings();
    expect(s.muted).toBe(true); // existing field preserved
    expect(s.reduceMotion).toBe(false); // missing field filled from DEFAULT_SETTINGS
  });

  it('Safari Private Mode: load degrades to in-memory defaults; save never throws', () => {
    installThrowingStorage();
    expect(loadSettings()).toEqual({ muted: false, reduceMotion: false });
    expect(() => saveSettings({ muted: true, reduceMotion: true })).not.toThrow();
  });
});
