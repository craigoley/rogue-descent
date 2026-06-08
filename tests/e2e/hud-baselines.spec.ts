/**
 * L2 DOM/HUD visual-regression baselines — the RELIABLE half of the screenshot tier.
 *
 * The WebGL canvas is a noisy pixel blob to a screenshot differ (GPU/driver/AA
 * variance), so we do NOT baseline it (see screenshots.spec for the dormant,
 * opt-in canvas captures; the 3D scene is human-eyeball-only via the Vercel preview).
 * Instead we baseline the DOM HUD overlay — where our actual regressions happen
 * (e.g. the A1 chips-vs-minimap overlap, #75):
 *
 *   1. boot a frozen, fixed-seed frame (?still=1&seed) so nothing animates,
 *   2. HIDE the full-viewport WebGL canvas (canvas:not(.minimap)) — NOT mask it
 *      (its rect is the whole viewport, so a mask would paint over the HUD too) —
 *      so the transparent HUD gaps show the solid page background instead of canvas,
 *   3. MASK the minimap (itself a 2D <canvas>): captures its position/size as a box
 *      while excluding its 2D-render variance,
 *   4. screenshot the viewport → a deterministic picture of the HUD layout.
 *
 * Baselines are platform-tagged (-chromium-linux) and MUST be generated on the CI
 * runner (ubuntu) — local macOS/Windows font rasterisation differs and would never
 * match. Generate/refresh with `--update-snapshots` on ubuntu (Docker linux image or
 * the e2e workflow), then commit the PNGs. NON-BLOCKING: this runs in the nightly/
 * informational e2e workflow only, never gates a PR (a visual diff needs human eyes).
 */
import { test, expect, type Page } from '@playwright/test';

/** Boot a frozen, fixed-seed frame and hide the WebGL canvas so only the DOM HUD
 *  (over the solid --bg) remains. */
async function bootHudOnly(page: Page): Promise<void> {
  await page.goto('/?still=1&seed=12345');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });
  await page.evaluate(() => {
    // The WebGL game canvas has no class; the minimap is canvas.minimap.
    const c = document.querySelector('canvas:not(.minimap)') as HTMLElement | null;
    if (c) c.style.visibility = 'hidden';
  });
}

/** Screenshot options: mask the minimap (a 2D canvas) so its box position is checked
 *  but its pixels aren't, and use a TIGHT per-pixel threshold. The global config's
 *  maxDiffPixelRatio 0.04 was sized for noisy WebGL; for these noise-free DOM-over-
 *  solid-bg shots it's far too loose — empirically a 36px HUD band shift slipped
 *  through at 0.04 on the large (1440/900) viewports (the thin HUD is <4% of a big
 *  viewport). 0.005 catches that shift at EVERY viewport while staying green on an
 *  unchanged render (the only residual is cross-Chromium-version font AA, controlled
 *  by the lockfile pin + this suite being non-blocking). Verified nudge→RED→revert→
 *  GREEN at all 6 shots. */
const shotOpts = (page: Page) => ({ mask: [page.locator('.minimap')], maxDiffPixelRatio: 0.005 });

// The A1 dimension: the chip row / bars / minimap-box layout per width.
const HUD_VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 900, h: 600 },
  { w: 768, h: 1024 },
  { w: 380, h: 780 },
];
// Settings panel layout — wide + narrow is enough (it's a fixed-size top-right panel).
const SETTINGS_VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 380, h: 780 },
];

test.describe('L2 HUD visual baselines (DOM overlay; canvas hidden, minimap masked)', () => {
  for (const vp of HUD_VIEWPORTS) {
    test(`play HUD ${vp.w}x${vp.h}`, async ({ page }) => {
      await bootHudOnly(page);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(150); // let the responsive HUD reflow
      await expect(page).toHaveScreenshot(`hud-${vp.w}.png`, shotOpts(page));
    });
  }

  for (const vp of SETTINGS_VIEWPORTS) {
    test(`settings open ${vp.w}x${vp.h}`, async ({ page }) => {
      await bootHudOnly(page);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(100);
      await page.locator('.hud-settings-btn').click(); // open the panel
      await page.waitForTimeout(100);
      await expect(page).toHaveScreenshot(`hud-settings-${vp.w}.png`, shotOpts(page));
    });
  }
});
