/**
 * L3 — LIVE-VALIDATION SWEEP (tagged @validation; runs via its own non-blocking workflow,
 * NOT the lean e2e smoke job). The layer L1 (pure sim) and L2 (frozen-frame HUD baselines, the
 * canvas HIDDEN) structurally can't see: the UNFROZEN game loop + the live WebGL canvas + the
 * console, over a SUSTAINED seeded soak. It reads the debug-only `window.__validation` snapshot
 * (the precursor PR) to assert this game's known risk classes — NaN (bruiser lunge / boss
 * knockback), pool integrity (kill-pop #90 / pooled figures), no-softlock (#95), still-rendering,
 * memory — plus console-error capture, and a couple of live-flow specs the frozen baselines can't
 * exercise (settings, death→restart).
 *
 * FIND, DON'T FIX: a failure is a REPRODUCIBLE finding — every assertion carries the seed, so it
 * replays via `?seed=<S>`; fixes land in a SEPARATE triage PR.
 *
 * HARNESS-vs-GAME (#1): waits on REAL states (data-ready, .is-visible), never races; a
 * mid-transition sample (the hook's defensive safe-partial / undefined) is SKIPPED, not failed;
 * the sweep can never be the thing that breaks and cries wolf.
 */
import { test, expect, type Page } from '@playwright/test';

const SEED = 12345;

/** Fixed pool caps — MIRROR `POOL` in src/utils/constants.ts. Active counts must never exceed
 *  these (the pools are fixed-size; a breach means the hook or a pool changed). */
const POOL_CAPS = { enemies: 8, projectiles: 32, enemyProjectiles: 24, particles: 96, pickups: 16 } as const;

/** The debug-only live-state snapshot (window.__validation, from the precursor PR). */
interface Snap {
  frame: number;
  seed: number;
  depth: number;
  activeRoom: number;
  runOver: boolean;
  player: { x: number; y: number; health: number };
  counts: { enemies: number; projectiles: number; enemyProjectiles: number; particles: number; pickups: number };
  anyNaN: boolean;
  error?: string;
}

/** Console ALLOWLIST — PROVEN-benign info/warn only (each with a reason). Anything else — and
 *  ALL console.error / pageerror / the `⚠ SOFTLOCK DETECTED` warn — is a FINDING. Conservative:
 *  an UNKNOWN warning is NOT benign. */
const ALLOW: RegExp[] = [
  /^\[pos\]/, // debug position trace (main.ts)
  /^⚠JUMP \[pos\]/, // the trace's teleport-flag variant (still just the pos trace)
  /^\[dungeon\] /, // floor-generation funnel
  /^\[bloom\] auto-downgraded/, // bloom quality auto-tier (SceneManager)
  /^\[softlock\] (enemy|room) /, // softlock TRACE lines — NOT the ⚠ DETECTED warn
  /EffectComposer|UnrealBloomPass|WebGL.*(performance|deprecat)/i, // three.js post-chain RTT chatter
];
const isAllowed = (text: string): boolean => ALLOW.some((re) => re.test(text.trim()));

/** Capture UNEXPECTED console errors/warns + uncaught page errors, and the softlock warn
 *  separately (it's a dedicated canary, never allowlisted). */
function trackConsole(page: Page): { errors: string[]; softlock: string[] } {
  const errors: string[] = [];
  const softlock: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/⚠ SOFTLOCK DETECTED/.test(t)) {
      softlock.push(t);
      return;
    }
    if (m.type() === 'error') errors.push(`console.error: ${t}`);
    else if (m.type() === 'warning' && !isAllowed(t)) errors.push(`console.warn(unexpected): ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, softlock };
}

/** Read one live snapshot. Returns undefined if the hook isn't attached yet (pre-ready). */
const sample = (page: Page): Promise<Snap | undefined> =>
  page.evaluate(() => (window as unknown as { __validation?: () => Snap }).__validation?.());

/** JS heap (bytes) after a FORCED GC — the force-GC bracket removes the normal-alloc sawtooth
 *  so a leak (not noise) is what the before/after compare measures. */
async function gcHeapBytes(page: Page): Promise<number> {
  await page.requestGC();
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const { metrics } = await client.send('Performance.getMetrics');
  await client.detach();
  return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
}

const DIRS = ['d', 's', 'a', 'w'] as const;

test.describe('@validation live sweep', () => {
  test('@validation seeded soak — NaN / pool / progress / render / memory / console', async ({ page }) => {
    const SOAK_MS = 90_000;
    const SAMPLE_MS = 2500;
    const FLOOR_TARGET = 4; // depth starts at 1; reaching 4 = 3 floors descended → early-exit
    test.setTimeout(SOAK_MS + 60_000);

    const { errors, softlock } = trackConsole(page);
    // Seeded LIVE boot (no ?still → the loop RUNS); the E2E seam drops straight into floor 1 with
    // no cards. ?debug attaches the validation hook + the [pos] trace.
    await page.goto(`/?debug=1&seed=${SEED}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });

    // Warm up a beat, then bracket memory with a forced-GC heap reading.
    await page.waitForTimeout(1000);
    const heapStart = await gcHeapBytes(page);

    const snaps: Snap[] = [];
    let di = 0;
    let prevFrame = -1;
    await page.keyboard.down(DIRS[di]);
    const start = Date.now();
    while (Date.now() - start < SOAK_MS) {
      await page.waitForTimeout(SAMPLE_MS);
      const s = await sample(page);
      // Defensive: a mid-transition safe-partial (hook returned {error}) or a not-yet-ready
      // undefined is NOT a failure — skip it (harness-vs-game: the hook can't be the wolf).
      if (!s || s.error) {
        console.log(`[VALIDATION] skip (partial/undefined) seed=${SEED}`);
        continue;
      }
      console.log(
        `[VALIDATION] frame=${s.frame} seed=${s.seed} depth=${s.depth} activeRoom=${s.activeRoom} ` +
          `runOver=${s.runOver} anyNaN=${s.anyNaN} counts=${JSON.stringify(s.counts)}`,
      );
      snaps.push(s);
      const ctx = `seed=${SEED} frame=${s.frame} depth=${s.depth} counts=${JSON.stringify(s.counts)} (replay: ?seed=${SEED})`;

      // 1. NO NaN — player + active enemy positions finite.
      expect(s.anyNaN, `NaN canary tripped — ${ctx}`).toBe(false);
      // 2. POOL INTEGRITY — active counts never exceed the fixed caps.
      for (const k of Object.keys(POOL_CAPS) as (keyof typeof POOL_CAPS)[]) {
        expect(s.counts[k], `pool '${k}' over cap ${POOL_CAPS[k]} — ${ctx}`).toBeLessThanOrEqual(POOL_CAPS[k]);
      }
      // 5. STILL RENDERING — the frame counter advances between samples (the loop is alive).
      expect(s.frame, `frame counter stalled (render loop not drawing) — ${ctx}`).toBeGreaterThan(prevFrame);
      prevFrame = s.frame;
      // 3a. NO SOFTLOCK banner on screen.
      expect(
        await page.locator('.hud-softlock-banner.is-visible').count(),
        `softlock banner shown — ${ctx}`,
      ).toBe(0);

      // Drive varied combat: rotate direction, melee, dash — surfaces lunge/knockback edges.
      await page.keyboard.up(DIRS[di]);
      di = (di + 1) % DIRS.length;
      await page.keyboard.down(DIRS[di]);
      await page.keyboard.press('j');
      await page.keyboard.press(' ');

      if (s.depth >= FLOOR_TARGET || s.runOver) break;
    }
    await page.keyboard.up(DIRS[di]);

    expect(snaps.length, `no valid samples captured (hook never returned) — seed=${SEED}`).toBeGreaterThan(3);

    // 3b. PROGRESS / no-wedge (aim-agnostic): depth advanced OR the player kept acting (moved).
    const first = snaps[0];
    const movedMax = snaps.reduce(
      (m, s) => Math.max(m, Math.hypot(s.player.x - first.player.x, s.player.y - first.player.y)),
      0,
    );
    const depthAdvanced = snaps[snaps.length - 1].depth > first.depth;
    expect(
      depthAdvanced || movedMax > 1.0,
      `WEDGED — no depth progress and the player never moved (seed=${SEED}, movedMax=${movedMax.toFixed(2)})`,
    ).toBe(true);

    // 2b. LEAK canary — transient pools must DRAIN: particles can't legitimately stay pinned at
    // cap across the whole soak (pinned = a recycle leak, the #90 class).
    const particlesPinned = snaps.every((s) => s.counts.particles >= POOL_CAPS.particles);
    expect(particlesPinned, `particle pool pinned at cap all soak (recycle leak?) — seed=${SEED}`).toBe(false);

    // 6. MEMORY — force-GC bracket: no UNBOUNDED heap growth across the soak (generous bound to
    // clear JIT/normal growth; an actual per-frame leak over 90s balloons far past this).
    const heapEnd = await gcHeapBytes(page);
    console.log(
      `[VALIDATION] heapStart=${heapStart} heapEnd=${heapEnd} ratio=${(heapEnd / Math.max(1, heapStart)).toFixed(2)} seed=${SEED}`,
    );
    expect(heapEnd, `heap grew unbounded (${heapStart} → ${heapEnd}) — seed=${SEED}`).toBeLessThan(
      heapStart * 2.5 + 10_000_000,
    );

    // 3c / 4. The softlock detector never fired, and no UNEXPECTED console errors across the soak.
    expect(softlock, `softlock detector fired — ${softlock.join('\n')} (seed=${SEED})`).toHaveLength(0);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('@validation live flow — settings gear opens + closes, no error', async ({ page }) => {
    const { errors } = trackConsole(page);
    await page.goto(`/?seed=${SEED}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });

    await page.locator('.hud-settings-btn').click(); // gear toggles the panel (pointerdown)
    await expect(page.locator('.hud-settings-panel')).toHaveClass(/is-open/);
    await page.keyboard.press('Escape'); // dismiss
    await expect(page.locator('.hud-settings-panel')).not.toHaveClass(/is-open/);

    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('@validation live flow — death → run summary → restart (no error through the transition)', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const { errors } = trackConsole(page);
    await page.goto(`/?debug=1&seed=${SEED}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 15_000 });

    // Drive into combat to provoke damage. Blind input can't GUARANTEE death (no aim), so this is
    // best-effort: if runOver is reached we assert the full summary→restart flow; if not, we still
    // assert zero errors over a long aggressive session (a real guarantee) and annotate that death
    // wasn't reached — never a hard-fail on the harness's own mechanics (harness-vs-game #1).
    let reached = false;
    let di = 0;
    const start = Date.now();
    while (Date.now() - start < 80_000) {
      await page.keyboard.down(DIRS[di]);
      await page.waitForTimeout(1500);
      await page.keyboard.up(DIRS[di]);
      di = (di + 1) % DIRS.length;
      const s = await sample(page);
      if (s && !s.error && s.runOver) {
        reached = true;
        break;
      }
    }

    if (reached) {
      await expect(page.locator('.run-summary')).toHaveClass(/is-visible/, { timeout: 5_000 });
      await page.locator('.run-summary-restart').click();
      await expect(page.locator('.run-summary')).not.toHaveClass(/is-visible/);
      // A fresh run is live again (runOver back to false) — the restart transition didn't wedge.
      await expect
        .poll(async () => (await sample(page))?.runOver, { timeout: 10_000 })
        .toBe(false);
    } else {
      testInfo.annotations.push({
        type: 'note',
        description: `death not reached in 80s on seed=${SEED} (blind input) — summary→restart flow unverified this run; a follow-up can pin a deadlier seed. Console was clean.`,
      });
    }

    // The prime catch either way: nothing THREW across the driven session / the death screen.
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
