/**
 * L2 screenshot BASELINES — the flaky, opt-in extra. WebGL output is platform-
 * specific (GPU/driver/AA), so committed baselines must be generated on the CI
 * runner (ubuntu-latest), NOT a dev machine. Until those baselines exist these
 * are SKIPPED, so a missing baseline never reports a false failure. To generate /
 * refresh them (on ubuntu — locally via a Linux container, or the e2e workflow):
 *   E2E_SNAPSHOTS=1 npm run test:e2e -- --update-snapshots
 * then commit the tests/e2e/__screenshots__ (or *-snapshots) PNGs. The captures
 * use ?still=1 (frozen first frame) so the animating canvas is deterministic.
 */
import { test, expect } from '@playwright/test';

const SNAPSHOTS = process.env.E2E_SNAPSHOTS === '1';

test.describe('L2 visual baselines (opt-in)', () => {
  test.skip(!SNAPSHOTS, 'baselines are generated + committed on ubuntu CI via --update-snapshots');

  test('spawn-room first frame', async ({ page }) => {
    await page.goto('/?seed=12345&still=1');
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });
    await expect(page.locator('canvas').first()).toHaveScreenshot('spawn-frame.png');
  });

  test('boss room', async ({ page }) => {
    await page.goto('/?seed=12345&scene=boss&still=1');
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });
    await expect(page.locator('canvas').first()).toHaveScreenshot('boss-room.png');
  });
});
