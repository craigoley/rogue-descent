# L3 — Playwright-MCP smoke recipe (low ceiling; read this first)

This is the **third, lowest** layer of the validation stack. It exists so a future
agent thread knows exactly what Playwright-MCP **can** and **cannot** do against
this game — and has a ready recipe — **not** because L3 is a test suite worth
building. It isn't: do **not** build MCP-driven gameplay tests or CI around this.

For anything automatable, use the higher layers instead:

| Layer | Tool | Gates | Use for |
|---|---|---|---|
| **L1** | Vitest, `npm test` | every PR (+ auto-merge) | **All sim-correctness checks.** Deterministic, headless, fast. Preferred. |
| **L2** | Playwright, `npm run test:e2e` | nightly / non-blocking | "Did it render / did it visually break." |
| **L3** | Playwright **MCP** | none (ad-hoc) | Human-in-the-loop: boot the live build, eyeball it, read live telemetry. |

---

## ⚠️ The canvas wall (the key expectation-setter)

The entire game renders into **one opaque `<canvas>`** (Three.js/WebGL). To the
DOM/automation it is a single element with **no inspectable contents**. So MCP /
Playwright **cannot see, click, hover, or aim at anything *inside* the scene** —
not the player, an enemy, the boss, a pickup, a wall, or the stairs.

Consequence: **MCP cannot "play" the game and cannot verify any visual or gameplay
outcome.** It can only drive blind input and read the DOM/console telemetry the
game prints *outside* the canvas. Anything you'd want to assert about gameplay is
already better covered, deterministically, by L1.

---

## What the MCP agent CAN do (the recipe)

Drive the deployed build (the Vercel production URL or any PR preview), with
`?debug=1` to expose telemetry. Concrete sequence:

1. **Boot** `https://<deployed-build>/?debug=1`
   (production, or a PR preview URL from the Vercel check on the PR).
2. **Wait** for the canvas to mount: a `<canvas>` element exists with non-zero
   size. (There is no app "ready" flag on `main`; the L2 hook adds
   `body[data-ready="1"]` + `?seed`/`?scene`/`?still` — use those if this build
   includes PR #58. Otherwise just wait for the canvas + first console line.)
3. **Read the `?debug` overlay** (DOM text, fully readable — it's HTML, not canvas):
   - `.hud-depth` → always shows `DEPTH <n>`.
   - `.hud-readout` (a `<pre>`, debug-only) → the live state dump: depth /
     floorsCleared / kills, `all-cleared` + `stairs-active` + `stairs-room`,
     run time, difficulty multipliers, live enemy mix, powerup levels, dash
     charges, `rooms X/Y cleared  active <i>`, drop tallies, etc.
4. **Read console traces** (`page.on('console')`): on load `[dungeon] seed=… rooms=…
   connected=…`; with `?debug=1` per-step `[pos] (x,y) Δ… room… active…`,
   `[encounter] room i -> <phase>`, `[drop] spawned/collected …`; always-on
   `[softlock] …` (kill + room-cleared transitions). These are the live
   funnel/telemetry surface.
5. **Send keyboard input to the window** — the listeners are on `window` (see
   `src/input/Controls.ts`), so synthetic key events reach `Controls → InputIntent
   → the sim`:
   - **WASD / arrows** = move · **J** = melee · **K** = ranged (held) · **Space**
     = dash · **M** = mute · **G** = regenerate floor (`?debug` only).
   - **Confirm movement via the `[pos]` trace** (the `(x,y)` changes), **not** by
     looking at the canvas.
6. **Screenshot** the page for a **human** to eyeball (the only "visual" use — a
   person interprets it; the agent cannot).

That's the whole ceiling: **blind keyboard smoke + DOM/console telemetry reading +
a screenshot for a human.**

---

## What it CANNOT do

- **Aim.** Desktop aim is the mouse position **relative to the player's on-screen
  position** — computing it needs reading the canvas/scene, which MCP can't. So
  **ranged and aimed-melee are effectively unusable** (no meaningful aim vector).
  Only move / dash / auto-facing melee respond.
- **Navigate intentionally.** With no scene vision there's no way to path to a
  target room, the boss, or the stairs — movement is blind.
- **Verify any visual or gameplay result.** Did the hit land? Did the boss die?
  Does the stun tell read? Is the screenshot "right"? MCP cannot judge any of it.
  Those belong to **L1** (state assertions) or a **human** (feel).

---

## When to reach for L3 (rarely)

Only for **ad-hoc, human-in-the-loop** checks on the *live* build: "boot the
deployed game and eyeball that it loads and roughly looks alive," or "read the live
`?debug` overlay / console traces on production." For anything you want to **assert
automatically**, prefer L1 — its telemetry is strictly richer and deterministic,
and it runs in CI. L3's telemetry is the same data, but live, slower, blind, and
unasserted. Treat it as a manual diagnostic, not a gate.
