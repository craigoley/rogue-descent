import { defineConfig, devices } from '@playwright/test';

/**
 * L2 — Playwright screenshot/smoke. SEPARATE from `npm test` (Vitest): run via
 * `npm run test:e2e`. Boots the built app (vite preview) and checks it actually
 * RENDERS (canvas mounts, not blank, no console errors) plus optional WebGL
 * screenshot baselines. Pinned to Chromium; CI runs it on ubuntu-latest (the
 * platform the committed screenshot baselines must match — generate/refresh them
 * there with `npm run test:e2e -- --update-snapshots`).
 */
const PORT = 4173; // vite preview default
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['line']] : 'line',
  // WebGL output varies a little by GPU/driver/AA — allow a small per-pixel diff
  // so baselines aren't brittle. (Screenshot tests are opt-in; see screenshots.spec.)
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.04, animations: 'disabled' },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Build once, then serve the production bundle (deterministic — matches deploy).
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
