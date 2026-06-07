/**
 * L2 blind-keyboard LIVE smoke — the only check that exercises the actual built
 * artifact + a real browser + the input path END-TO-END (L1 = pure sim, no browser;
 * smoke.spec = render on a frozen frame). It boots the running build, drives scripted
 * keyboard input, and asserts via TELEMETRY (the ?debug [pos] console trace), NOT
 * vision (the canvas wall): input reaches the sim and moves the player, and nothing
 * errors over a real session.
 *
 * CAN assert: boots, keyboard → sim → player moves, zero errors.
 * CANNOT assert: aim (mouse-relative-to-canvas), navigation, or any visual/gameplay
 * outcome — including whether melee/dash actually HIT (no positional signal). So J +
 * Space are exercised for the no-error guarantee only.
 *
 * Failure mode is safe: the core assertion is "the player moved", so a keyboard that
 * doesn't reach the sim makes this RED, never a false green.
 */
import { test, expect, type Page } from '@playwright/test';

/** Console-error + uncaught-page-error collector (mirrors smoke.spec). */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Collect player positions from the ?debug `[pos] (x,y) Δ… …` console trace. */
function trackPositions(page: Page): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  page.on('console', (m) => {
    const match = /\[pos\] \(([-\d.]+),([-\d.]+)\)/.exec(m.text());
    if (match) positions.push({ x: Number(match[1]), y: Number(match[2]) });
  });
  return positions;
}

test('blind-keyboard live smoke: boots, input moves the player, no errors', async ({ page }) => {
  const errors = trackErrors(page);
  const positions = trackPositions(page);

  // ?debug for the [pos] trace; fixed seed for determinism; NO ?still (the loop must
  // keep running so held input is processed frame after frame).
  await page.goto('/?debug=1&seed=12345');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });

  // INPUT -> MOVEMENT (the end-to-end proof): hold a move key so intent.moveX stays
  // set across frames; the sim moves the player each step and traces [pos].
  await page.keyboard.down('d');
  await page.waitForTimeout(600);
  await page.keyboard.up('d');
  await page.waitForTimeout(100);

  // The player moved: the trace logged positions, and they span a real distance
  // (well above noise; maxSpeed 7 over ~0.6s ≫ 0.5 world units). Spawn is the open
  // spawn-room centre, so a held direction always has room to move.
  expect(positions.length, 'no [pos] trace captured — keyboard did not reach the sim').toBeGreaterThan(0);
  const first = positions[0];
  const last = positions[positions.length - 1];
  const moved = Math.hypot(last.x - first.x, last.y - first.y);
  expect(moved, `player barely moved (${moved.toFixed(3)}) — input did not drive the sim`).toBeGreaterThan(0.5);

  // Exercise melee + dash through the real input path — no readable hit/positional
  // signal (canvas wall), so this only guarantees they fire WITHOUT erroring.
  await page.keyboard.press('j'); // melee
  await page.keyboard.press(' '); // dash
  await page.waitForTimeout(300);

  // No console errors / uncaught exceptions across the whole driven session.
  expect(errors, errors.join('\n')).toHaveLength(0);
});
