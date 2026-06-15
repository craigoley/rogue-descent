# Live-Validation Sweep — Recon (RECON ONLY; build is a 2nd PR)

A Playwright **live-validation sweep** that hunts the bug class the current stack
**structurally can't see**: runtime exceptions, NaN, soak-crashes, error-storms, and pool
leaks on the **live WebGL canvas + real game loop**, over a **sustained seeded soak**.

This document is the STEP-0 recon (the 6 deliverables). It does **not** build the sweep —
the `validation.spec.ts` + npm script + `validation.yml` workflow are a second PR after Craig
confirms the flows + hooks below.

> **Motivating evidence (the framing):** the last several real bugs — #103 (boss weak-side
> colour-collision + misleading hit-feedback), the boss feel, the kill-pop / bruiser pool
> care — **all passed the full green suite** and were caught only by Craig *playing*. This
> sweep automates the **machine-catchable half** of that (exceptions, NaN, soak-crashes,
> leaks). It does **not** replace the eyeball (it can't judge "does the green arc *read*
> well"); it catches "the game *threw* on the death screen" / "a position went NaN after 90s".

---

## TL;DR — the one blocking finding

**The game has no structured live-state read hook.** Today a test can read only: the
`?debug=1` `[pos]` **console trace** (player position + Δ + room/active/seed/depth + a
`⚠JUMP` flag) and the `.hud-readout` **debug `<pre>` text** (live enemy counts, depth, kills,
drops…) and the always-on `.hud-softlock-banner`. That covers *some* canaries (player NaN,
teleport, softlock, progress) but **not** enemy-position NaN, particle/pickup/projectile pool
counts, or `runOver` cleanly — and parsing debug text is brittle.

➡️ **Recommendation: a tiny read-only `window.__validation` precursor mini-PR** (debug-gated,
`src/game/`-pure-safe, ~15 lines in `main.ts`) **before** the sweep. See §2. Everything else
(readiness, determinism, flows, CI) is already in place and proven.

---

## 1. The game's actual live flows (real selectors / URLs / hooks)

All overlays are DOM children of `#app`; they toggle a `.is-visible` class. Boot params are
parsed in `main.ts:61` (`?seed=`, `?scene=boss`, `?still=1`, `?debug=1`).

⚠️ **Critical seam (`main.ts:64-66, 139-140`):** an **E2E boot** —
`?seed=<digits>` **OR** `?scene=boss` **OR** `?still=1` — sets `isE2EBoot = true`, which
**bypasses `beginRun()`** and the pre-run **cards**. So:
- A seeded live boot (`?seed=12345`, no `?still`) drops you **straight into a running floor-1
  run with no cards** — ideal for the **soak** (nothing to dismiss).
- To exercise the **card flows** (lean / heat) a test must either boot **non-E2E** (default
  seed, which needs `localStorage` meta with an unlock to trigger `shouldOfferLean`/
  `shouldOfferHeat`), or seed `localStorage` before `goto`. The cards are **not reachable from
  a seeded boot** — flag for the build.

| Surface | How reached (live) | Selector(s) | Notes |
|---|---|---|---|
| **Boot / readiness** | `goto('/?seed=12345')` | `body[data-ready="1"]` | set on first painted frame (`main.ts:438`). |
| **Run START — lean card** | non-E2E boot w/ an unlock, or inject `localStorage` meta | `.run-start-overlay.is-visible`, rows `.run-start-row`, selected `.run-start-row.is-selected` | `RunStartCard.ts`; click a `.run-start-row` to choose. |
| **Run START — heat card** | after first win (`shouldOfferHeat`), post-lean | `.heat-card`, steppers `.heat-step-btn`, confirm `.heat-confirm` | `HeatCard.ts`; reuses `.run-start-overlay` frame. |
| **COMBAT (soak core)** | seeded live run + drive input | canvas `canvas:not(.minimap)`; telemetry via `[pos]` trace / `.hud-readout` | the main soak loop — see §3. |
| **BOSS fight (weak-arc live render)** | `goto('/?seed=12345&scene=boss')` (no `?still` → live) | canvas; boss spawns on first sim step (`main.ts:67-81`) | a good live-render + NaN target (boss knockback). |
| **DESCEND transition (wipe)** | soak until floor clears → stairs → step on them | `.hud-floor-transition` (opacity/clip driven) | the floor-swap cover; a live-render transition. |
| **GOLDEN CHEST choice** | soak into a chest room; pickup pair w/ `spawnGrace` | world pickups (no DOM); toast on collect | the 1-of-2 choice is in-world (canvas), not DOM. |
| **DEATH → RUN SUMMARY → restart** | soak until `game.runOver` (or take damage to 0) | `.run-summary.is-visible`, `.run-summary-restart` | `RunSummary.ts`; restart re-enters `beginRun`. |
| **SETTINGS (gear → panel, post-#102)** | always present | `.hud-settings-btn` → `.hud-settings-panel.is-open` | proven clickable in `hud-baselines.spec`. |
| **UNLOCKS surface** | opened from a menu | `.unlocks-overlay.is-visible`, `.unlocks-close` | `UnlocksOverlay.ts`. |
| **Dynamic HUD (title fade / chip flares / defensive chips)** | on room-entry during the soak | `.hud-title.is-faded`, `.hud-chip.is-flaring`, `.hud-chip.is-maxhp`, `.hud-chip.is-armor` | live state transitions L2's frozen frames can't see. |

**Stable hooks today:** all of the above are stable **class** selectors (no `data-testid`).
**Hooks to ADD (flag minimal):** none strictly required for selectors; the one real gap is the
**live-state read** (§2), not a DOM selector.

---

## 2. Readiness + determinism hooks (and the one gap)

**Readiness — already solid.** `body[data-ready="1"]` is set on the first painted frame
(`main.ts:436-438`); every L2 spec waits on it
(`expect(page.locator('body')).toHaveAttribute('data-ready','1',{timeout:15_000})`). The sweep
reuses this verbatim — **never a bare timeout** (principle 6).

**Determinism — already solid + the edge to exploit.**
- `?seed=<n>` → `startNewRun(game, n, …)` (`main.ts:63`): a **seeded, reproducible** floor.
- `?still=1` → freezes on frame 1 (`main.ts:439`). The soak uses `?seed=` **WITHOUT** `?still`
  so the loop **runs live but deterministically** — a failure ships with the **exact seed to
  replay** (principle 6, rogue-descent's edge over a generic port).
- `?debug=1` → enables the `[pos]` per-tick trace + the `.hud-readout` panel + `PerfMeter`.
- `?scene=boss` → live boss room.

**Live-state read — THE GAP.** No `window.__*` hook exists (verified: `grep window.__` → none).
What's readable today:
- **`[pos]` console trace** (`main.ts:343-350`, debug-only): `(x,y) Δ … room N active M seed S
  depth D`, prefixed `⚠JUMP` when Δ exceeds 2× the max legit per-tick move. → gives **player
  NaN** (parse `x,y`), **teleport** (`⚠JUMP`), **progress** (depth/room/active deltas).
- **`.hud-readout` `<pre>`** (`HUD.ts`, debug-only): live `chaser/ranged/bolts` counts,
  `activeEnemyCount`, `activeRoom` phase, depth, kills, drops, dash charges. → some pool/entity
  counts, but as **brittle text**.
- **`.hud-softlock-banner.is-visible`** + `console.warn('⚠ SOFTLOCK DETECTED …')`: the always-on
  detector (`HUD.detectSoftlock`) — a **ready-made softlock canary** the sweep can assert never
  fires.

**Not cleanly exposed:** enemy/particle/pickup/projectile **NaN + pool counts**, `runOver`,
a frame counter. → **Recommend the precursor mini-PR:** a debug-gated, read-only

```ts
// main.ts (debug-gated; reads game state, mutates nothing — src/game/ stays pure)
if (isDebugEnabled()) {
  (window as Window & { __validation?: () => unknown }).__validation = () => ({
    frame, seed: game.seed, depth: game.run.depth, activeRoom: game.activeRoom,
    runOver: game.runOver,
    player: { x: game.player.x, y: game.player.y, health: game.player.health },
    counts: {
      enemies: game.enemies.filter(e => e.active).length,
      projectiles: game.projectiles.filter(p => p.active).length,
      enemyProjectiles: game.enemyProjectiles.filter(p => p.active).length,
      particles: game.particles.filter(p => p.active).length,
      pickups: game.pickups.filter(p => p.active).length,
    },
    anyNaN: !Number.isFinite(game.player.x) || !Number.isFinite(game.player.y) ||
            game.enemies.some(e => e.active && (!Number.isFinite(e.x) || !Number.isFinite(e.y))),
  });
}
```

Read from the test via `await page.evaluate(() => (window as any).__validation())`. **Justified
+ minimal + debug-gated** (zero cost in normal play, no `src/game/` change). This unlocks the
NaN / bounded-count / progress canaries robustly instead of by text-scraping.

---

## 3. The soak design (the crown jewel)

**Shape:** boot a **seeded live run** (`/?debug=1&seed=<S>`, no `?still`), wait `data-ready`,
then **auto-play** (drive keyboard input — hold a move key, periodic `j` melee / `space` dash,
mirroring `keyboard-smoke.spec`) for a meaningful stretch, **sampling canaries on an interval**
and logging every sample `[VALIDATION] state=X seed=S floor=N frame=F` (principle 4 — a hang is
identifiable before any timeout is touched).

**Canaries (precise, against THIS game's known risk classes):**

| Canary | Assertion | Source | Risk class it targets |
|---|---|---|---|
| **NO NaN** | player + all active enemy positions `Number.isFinite` | `window.__validation().anyNaN` (or `[pos]` for player) | bruiser **LUNGE** + boss **knockback** physics edges |
| **POOL INTEGRITY** | active counts stay `≤ POOL.*` **and DRAIN** (no monotonic climb that never recedes) | `__validation().counts` vs `POOL` (projectiles 32, enemies 8, enemyProjectiles 24, particles 96, pickups 16) | the recurring pool bug-class (kill-pop #90, bruiser, pooled figures) |
| **STATE-MACHINE / no-softlock** | run **keeps progressing** (depth advances or player keeps acting) **and** the softlock banner never shows | `__validation().depth`/`activeRoom` deltas + `.hud-softlock-banner` absent + no `⚠ SOFTLOCK` warn | encounter/door/activeRoom edges (the #95 class L1 didn't construct) |
| **NO CONSOLE ERRORS / no storm** | zero **unexpected** `console.error` + zero `pageerror` (after allowlist, §4); also assert **no error-storm** (count bounded) | `page.on('console')` + `page.on('pageerror')` (mirrors `smoke.spec`) | runtime exceptions on any live surface/transition |
| **STILL RENDERING** | the canvas keeps drawing across samples | a **frame counter** from `__validation().frame` advancing (preferred), or `canvas.toDataURL()` bytes changing between samples (⚠️ WebGL can't `getImageData`) | a silently-stalled render loop |
| **MEMORY (no leak)** | bracket with **force-GC**: `page.requestGC()` → sample `JSHeapUsedSize` → run soak → `page.requestGC()` → sample → assert **no unbounded growth** | Playwright CDP `page.requestGC()` (Chromium) + heap metrics | cumulative leaks (force-GC brackets avoid the normal sawtooth false-positive) |

**Duration / target:** a **multi-floor seeded stretch** — long enough to surface cumulative
bugs, bounded for CI. Proposal: **~90s of real loop OR ≥3 floors descended**, whichever first,
sampling every ~2-3s. Tune in the build PR against CI wall-time; keep it **one focused soak**
(plus a couple of short live-flow specs) so a hang is isolated, not buried in a 10-minute run.

**Auto-play caveat:** blind keyboard can't *aim* (mouse-relative-to-canvas) or guarantee
descent, so "≥3 floors" may not be reliably reachable by dumb input. Two honest options for the
build PR: (a) accept "advanced **or** kept acting for 90s, never wedged" as the progress
canary (robust, no aim needed); (b) add a tiny debug **auto-advance / god-mode** seam if deeper
floors must be reached deterministically. Lean (a) — it still catches NaN/leak/crash over a
long combat soak without over-engineering input.

---

## 4. Known-benign allowlist (conservative)

Scanned the running game's console output. **Allowlist only PROVEN-benign; an unknown warning
is a FINDING** (principle 3).

| Pattern | Why benign |
|---|---|
| `[pos] …`, `⚠JUMP [pos] …` | debug position trace (`main.ts:347`) — `console.info`, diagnostic. |
| `[dungeon] seed=… rooms=… connected=…` | floor-gen funnel log (`main.ts:149`) — `console.info`. |
| `[bloom] auto-downgraded → …` | bloom quality auto-tier (`SceneManager.ts:182`) — `console.info`, expected on slow frames. |
| `[softlock] enemy/room …` (the trace lines) | the always-on softlock **trace** (`HUD.logTransitions`) — `console.info`. ⚠️ **BUT** `console.warn('⚠ SOFTLOCK DETECTED …')` is **NOT** allowlisted — it's a **finding**. |
| Three.js `EffectComposer`/`UnrealBloomPass` RTT / WebGL perf notes (e.g. ReadPixels/feedback-loop *warnings*, not errors) | the bloom post-chain (`RenderPass → UnrealBloom → OutputPass`) is RTT by design; driver perf chatter is not a bug. **Allowlist by message match, not blanket** — keep it tight. |
| Vite/Rolldown **build** chunk-size warning | build-time only (`> 500 kB` notice); never a runtime signal — won't appear in the page console anyway. |

⚠️ The allowlist is **message-pattern matched + documented inline** in the spec. `console.error`
and `pageerror` are **never** allowlisted (those are always findings). The list is intentionally
short — anything not on it that the sweep sees is surfaced.

---

## 5. How it complements the existing gates (zero overlap)

| Layer | Owns | Sees the live canvas? | The soak must NOT re-assert |
|---|---|---|---|
| **L1 — Vitest (~427)** | pure sim logic / determinism / pool invariants / the new guardrails | no (Node, no browser) | drop economy, DR/HP math, boss AI, pool-size caps — all proven here |
| **L2 — `hud-baselines.spec`** | DOM/HUD **frozen-frame** layout, **canvas hidden**, minimap masked (`?still=1`) | no (canvas hidden) | HUD layout / chip positions / overlap (#75) |
| **L2 — `smoke.spec` / `keyboard-smoke.spec`** | boots, canvas mounts + non-blank, input→sim moves player, **short** no-error window | yes, but **briefly** (~2s) | "it boots / renders something / input reaches sim" |
| **`?debug=1` PerfMeter** | FPS / 1%-low / frame-time | n/a | performance numbers |
| **➡️ THIS sweep** | **LIVE canvas + console + SUSTAINED SOAK**: no exceptions, no NaN, no leak, no error-storm, no softlock, loop-still-advancing over a multi-floor seeded run + the live interactive flows (cards, death→summary, settings, transitions) | **yes, unfrozen, for a stretch** | — |

The boundary (principle 5 / "logic lives at other layers, and ours already does"): the sweep
**never** re-checks sim math or HUD layout. It is the **only** layer that runs the **unfrozen
loop for a sustained stretch** and watches **console + runtime health**. `smoke.spec` is its
2-second cousin; the soak is the same idea **scaled to a multi-floor session with structured
canaries** — it *extends*, doesn't duplicate.

---

## 6. The wiring

**npm script** (mirrors `test:e2e`):
```jsonc
"test:e2e:validation": "playwright test validation"
```

**Workflow `validation.yml`** — model on `e2e.yml`'s proven setup (ubuntu, Chromium,
`npm ci` → `npx playwright install --with-deps chromium` → build+preview webServer, the
`data-ready` waits):
- **Triggers:** `workflow_dispatch` (manual replay of a seed) **+** `schedule:` nightly
  (the soak is a time-cost; keep it off the per-PR path initially). Optionally a labelled-PR
  trigger later.
- **NON-BLOCKING initially** (principle 1 + the L2 precedent): a reporting gate until proven
  non-flaky, **then** consider blocking. Use the `github` reporter; don't add to required checks.
- **Artifacts on failure (reproducibility — principle 1/2):** upload the Playwright **trace**,
  the **iteration log** (`[VALIDATION] …`), a **screenshot**, and surface the **seed** in the
  failure message so a finding replays via `?seed=<S>`. Reuse `actions/upload-artifact@v7`
  (`if: ${{ !cancelled() }}`) as `e2e.yml` already does.

⚠️ **Baseline-workflow gotcha — does it apply here? NO, by design.** `e2e.yml`'s
`workflow_dispatch` job **commits baselines back** with `GITHUB_TOKEN` (`e2e.yml:80-89`), which
is exactly the path that bit on **GITHUB_TOKEN-not-triggering-CI + the bot-commit merge-race**
(#99/#101). The validation sweep **only uploads artifacts — it never commits or pushes back**,
so it **cannot** trip that race. Keep it that way: **findings → a separate triage/bugfix PR**
(principle 2), never an auto-commit from the workflow.

---

## Principles → design (the trust contract)

1. **Harness-vs-game:** wait on `data-ready` + read **real** state (`__validation` / banners),
   never a bare timeout/race; every failure triaged GAME-vs-TEST.
2. **Find, don't fix:** the sweep surfaces (repro seed + severity + artifacts); fixes are a
   separate PR.
3. **Allowlist:** tight, message-matched, documented; `console.error`/`pageerror` never allowlisted.
4. **Diagnose timeouts:** per-iteration `[VALIDATION]` logging → identify the hung state before
   touching any limit.
5. **Live layer is the point:** unfrozen loop + console + multi-floor soak — the explicit gap.
6. **Determinism/readiness:** `data-ready` + seeded `?seed=` soak → reproducible, replayable.

---

## Recommended PR sequence

1. **Precursor mini-PR (tiny):** the debug-gated read-only `window.__validation` hook (§2) +
   a one-line doc. ~15 lines, `src/game/` empty-diff, zero normal-play cost. Unblocks the robust
   canaries.
2. **The sweep PR:** `validation.spec.ts` (the seeded soak + a few live-flow specs embedding the
   6 principles) + `test:e2e:validation` + `validation.yml` (non-blocking, nightly + dispatch,
   artifacts-on-failure). Findings from its first runs → a **third** triage/bugfix PR.

*(If Craig prefers to fold the hook into the sweep PR, it's small enough — but a separate
precursor keeps the sweep PR pure-test and the hook independently reviewable.)*

— Recon only. No sweep built. Awaiting confirmation of flows + hooks (esp. the `window.__validation` precursor).
