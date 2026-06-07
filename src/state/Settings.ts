/**
 * Persisted player settings, backed by localStorage. Every access is wrapped in
 * try/catch: Safari Private Mode throws on `localStorage` writes (and can throw
 * on reads), so the game must degrade to in-memory defaults rather than crash.
 *
 * Phase 0 ships only the shape + safe load/save; real settings (audio volume,
 * control scheme, accessibility) populate it in later phases.
 */

const STORAGE_KEY = 'rogue-descent:settings';

export interface Settings {
  /** Master audio toggle. */
  muted: boolean;
  /** Accessibility: reduce motion — zeroes camera shake and softens the damage
   *  vignette (kept, as combat info). main.ts/render apply it; the sim is unaware. */
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  muted: false,
  reduceMotion: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode / quota failure: keep running with in-memory settings.
  }
}
