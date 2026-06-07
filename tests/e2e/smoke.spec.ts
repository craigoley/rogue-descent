/**
 * L2 smoke — the robust, baseline-free half: the app boots, the WebGL canvas
 * actually mounts + renders something, and nothing errors. These run anywhere
 * (no platform-specific baselines), so they're the reliable visual-regression
 * signal; the pixel baselines (screenshots.spec) are the flaky, opt-in extra.
 */
import { test, expect } from '@playwright/test';

/** Collect console errors + uncaught page errors across a test. */
function trackErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test('boots: data-ready, canvas mounts + sized, no console errors', async ({ page }) => {
  const errors = trackErrors(page);

  await page.goto('/?seed=12345');
  // Wait for the deterministic first-painted-frame flag (set by main.ts) — no sleep.
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });

  // The game canvas exists, is visible, and has non-zero size.
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // Let it run a couple of seconds — surfaces any per-frame runtime error.
  await page.waitForTimeout(2000);
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('the canvas is NOT blank (something rendered)', async ({ page }) => {
  // ?still=1 freezes on the first painted frame so the capture is deterministic.
  await page.goto('/?seed=12345&still=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });

  const canvas = page.locator('canvas').first();
  // A blank/solid canvas screenshot is a tiny PNG; a rendered 3D scene compresses
  // much larger. A generous floor avoids brittleness while still catching "blank".
  const shot = await canvas.screenshot();
  expect(shot.byteLength).toBeGreaterThan(3000);
});

test('?debug overlay shows sane initial state (depth 1)', async ({ page }) => {
  await page.goto('/?debug=1&seed=12345&still=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });
  // The always-on depth indicator — a non-visual smoke signal that state booted.
  await expect(page.locator('.hud-depth')).toHaveText(/DEPTH 1/);
});

test('the boss scene boots (?scene=boss) without errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?seed=12345&scene=boss&still=1');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const shot = await canvas.screenshot();
  expect(shot.byteLength).toBeGreaterThan(3000); // the boss room rendered
  expect(errors, errors.join('\n')).toHaveLength(0);
});
