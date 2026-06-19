# Rogue Descent — Content Appropriateness + Gameplay-Arc Recon

**Read-only findings report.** Surfaces issues with severity + a recommended direction; **no fixes applied** — Craig triages into separate PRs. Each finding tags **[DIRECT]** (I read the code/string/value) vs **[INFERENCE]** (I reasoned about it), per the standing rule.

> Scope note: this was a code/design audit run *alongside* Craig's live FEEL playtest. Anything about how something *feels* is flagged **PLAYTEST-CONFIRM** — I can read that depth 8 has boss stats X; whether it lands as a climax is Craig's eyeball.
>
> Cross-reference note: the brief asked to cross-check `PLAN.md`'s backlog. **There is no `PLAN.md` (or ROADMAP/DESIGN/backlog doc) in the repo** [DIRECT — `find` over the tree]. So the backlog items named in the brief (audio, per-floor themes, elites, synergy-surfacing) are cross-referenced *from the brief itself*, not a file. Where the arc review independently lands on one of those, I say so.

---

## ★ PRIORITIZED SUMMARY (what matters most, across both parts)

| # | Part | Finding | Severity |
|---|------|---------|----------|
| 1 | Arc | **W=8 has no climax.** No victory screen, no depth cap, no distinct final boss — reaching depth 8 only sets a hidden meta stat; the game continues endlessly and the player gets *no acknowledgment they won*. The arc doesn't "arrive." | **High** |
| 2 | Arc | **Heat is pure number-scaling.** All 4 modifiers multiply enemy damage/speed/HP/count — none changes *how* you play. The post-win long-tail is the Cogmind "exactly the same but numbers higher" anti-pattern. | **High** |
| 3 | Arc | **Onboarding teaches controls but not the *loop*.** The goal (descend → beat boss → reach W), what powerups *do*, and all synergies except wildfire are untaught. The #1 cited roguelike failure mode. | **High** |
| 4 | Arc | **Likely difficulty spike at depth 3** — ranged enemies, the armored chaser, *and* the boss's two-phase escalation all first land at depth 3 (swarmers at 4, bruiser at 5 stack right after). | **Med** (PLAYTEST-CONFIRM) |
| 5 | Content | **The game is clean for ESRB E10-ish / US-kid.** No profanity, no mature/suggestive/gambling/horror content, and — notably — **zero data egress** (no network, no analytics; localStorage only). Strongest positive. Only nit: dev surfaces (`?debug`, softlock banner) are technically reachable. | **Clean / minor** |

---

# PART 1 — CONTENT APPROPRIATENESS (US general audience + kids)

**Calibration:** the genre is fantasy twin-stick combat; cartoon/fantasy violence is expected and fine. The bar is "mild" (E10+). I read the actual strings/assets, not just file names.

## ✅ Clean confirmations (explicit — not manufactured)

- **Profanity / crude / edgy language: CLEAN** [DIRECT]. I enumerated all player-visible strings (HUD chip labels, buttons, `RunStartCard`, `RunSummary`, `UnlocksOverlay`, `HeatCard`, `Meta` unlock copy, `Controls` hints). Everything is plain arcade/genre vocabulary: `DASH`, `MELEE`, `RANGED`, `PIERCE`, `KNOCKBACK`, `LIFESTEAL`, `BURN`, `CHAIN`, `CRIT`, `FREEZE`, `FIRE RATE`, `MAX HP`, `ARMOR`, `DESCEND`, `RUN OVER`, `CHOOSE YOUR LEAN`. No profanity, no crude/suggestive terms, no edgy humor.
- **Violence framing: MILD / CLEAN** [DIRECT]. Death is framed as `RUN OVER` (`RunSummary.ts:49`) — neutral arcade "defeat," not grim/morbid. Entities are procedural humanoid **figures** (cylinder body + sphere head + a "visor eye"; `EntityRenderer.ts:2-3`); kills produce colored **spark pops** (`ENEMY_DEATH_TINT`, `constants.ts:~1568`), not blood/gore. No gore, dismemberment, cruelty, or dark death framing anywhere.
- **Suggestive / mature themes: CLEAN** [DIRECT]. No sexual, romantic, suggestive, or substance content in any string.
- **Gambling framing: CLEAN** [DIRECT]. Drops are ordinary RNG loot; the run-start *lean* (`RunStartCard.ts:43`: "Steer this run — your pick drops more often and arrives first.") is framed as *steering*, not betting/odds/slot-machine. No gambling vocabulary — important, since ESRB flags gambling *themes* specifically.
- **Scary / horror for kids: CLEAN** [DIRECT]. "descent / depth / dungeon" reads as adventure, not horror. No frightening/disturbing imagery or framing.
- **Region/idiom weirdness (the wild-trails UK-ism lesson): CLEAN for player-facing text** [DIRECT]. All *player-visible* strings are plain US English. British spellings (`colour`, `centre`) appear **only in code comments** (e.g. `constants.ts` palette comments), never in shipped strings — harmless.
- **Charged real-world symbols: CLEAN** [DIRECT]. Favicon/icon is the chevron (already vetted); entities are abstract geometry. No symbol that could read as a charged real-world mark.
- **Dev-isms shipped to players: CLEAN** [DIRECT]. `TODO`/`placeholder` appear only in comments (`SceneManager.ts:101`, `EntityRenderer.ts:6`), not in any player-visible string. No lorem/test/XXX strings reach the UI.
- **★ Kids + web/data lens: CLEAN and notably strong** [DIRECT]. The *only* `navigator.*` use is `navigator.maxTouchPoints` for touch detection (`Controls.ts:86`). **No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no analytics/telemetry, no external in-game links/CTAs.** All persistence is `localStorage` (`Best.ts`, `Meta.ts`, `Settings.ts`) — local to the device, Safari-Private-safe. Nothing is collected, stored off-device, or transmitted. From the ESRB Interactive-Elements / kids-privacy lens this is about as clean as a shared-by-URL web game gets.

## Minor / borderline content findings

### C-1 — Dev/diagnostic surfaces are technically player-reachable — **Minor / borderline**
- **Where:** the `?debug=1` tuning panel (`HUD.ts`, `isDebugEnabled()` at line ~87) and the **softlock auto-detector banner** which renders on-screen text ending `"(screenshot this — debug capture)"` (`HUD.ts:~551`) when a pathological no-progress stall is detected.
- **Why it'd read as weird:** [INFERENCE] not *inappropriate*, but a curious kid who appends `?debug=1`, or anyone who trips the softlock detector, would see raw developer diagnostics (FPS, sim internals, a wall of enemy/room dump text) — confusing/off-brand for a general player, not E10+-breaking.
- **Severity:** Minor (debug is URL-gated and undiscoverable in-game; the banner only fires on a bug condition).
- **Direction:** acceptable to leave; if desired, ensure the softlock banner copy is player-neutral or only console-logged in production. No content change needed for the rating.

### C-2 — "LIFESTEAL" + "blood crimson" — **Not a finding (confirming it's fine)**
- The `LIFESTEAL` chip + its "blood crimson" color (`constants.ts:130,157`) — "blood crimson" is a **color-name in a code comment**, not player-facing; the player sees only the word `LIFESTEAL` and a crimson chip. Lifesteal (heal-on-hit) is standard E10+ action-RPG vocabulary. **No change recommended** — logged only because the brief asked to check blood/violence terms.

**Part 1 verdict:** The game sits comfortably in an E10+ / US-kid-friendly profile. No blockers, no rewording needed for the rating. The data/privacy posture is a genuine strength.

---

# PART 2 — FULL GAMEPLAY-ARC REVIEW (research-grounded)

Arc shape under audit: cold first run → learning → first boss → descending → building → first "win" (W=8) → Heat long-tail. Findings are organized by the known roguelike failure modes.

## A — Onboarding / loop-legibility (the #1 cited failure)

### A-1 — The *loop and goal* are untaught (only controls are) — **High**
- **What's taught** [DIRECT]: input controls via `Controls.ts:95-97` (desktop: `"WASD move · Mouse aim · L-click FIRE · R-click MELEE · Space DASH"`; touch: `"Left: MOVE · Right: AIM"`), plus a one-time dodge lesson (`HUD.ts:322`: `"DASH through attacks to DODGE"`, shown on the first enemy telegraph). Good, as far as it goes.
- **What's NOT taught** [DIRECT — absence of any such string in the enumerated copy]:
  1. **The objective.** Nothing tells a cold player the goal is to *descend* and that a win-line exists (W=8). The only directional cue is the `DESCEND` stairs label + the `DEPTH N` counter. A new US player doesn't know what they're working toward.
  2. **What powerups do.** The HUD chips name effects (`PIERCE`, `KNOCKBACK`, `LIFESTEAL`, `CRIT`, …; `HUD.ts:298-313`) and the on-collect toast names the pickup — but nothing explains the *effect*. A player who grabs `PIERCE` sees a chip light up with no idea what changed.
  3. **Synergies.** Only **wildfire** (burn × chain) is surfaced, via the #117 cue. The other emergent combos (crit × lifesteal, freeze-for-positioning, pierce × multishot, etc.) are invisible — the player can't discover the build system's depth.
- **Severity:** High — this is precisely the most-cited roguelike onboarding failure ("the game does little to guide you toward the intended loop").
- **Direction:** a brief first-run objective beat ("Descend. Survive. Reach the depths." / surface the win-line), + lightweight powerup-effect surfacing (a one-line effect blurb on pickup or in a build readout), + extend the synergy-cue pattern (#117) to the other combos. *Independently confirms the brief's "synergy-surfacing" backlog item, and widens it to "powerup-effect + goal surfacing."*

## B — Difficulty curve (depth 1 → W=8)

### B-1 — Early game is appropriately gentle — **Clean** [DIRECT]
- Floor 1 is pure chaser (ranged gated to depth ≥ 3, `DIFFICULTY.rangedMinDepth:3`), all multipliers = 1.0 at depth 1 (`Difficulty.ts:48-60`), and the depth-1 boss is a deliberate carve-out: single-phase, 140 HP / 9 dmg vs the curve's would-be 220/20 (`constants.ts:1899-1900`, the #103/#104 fix). The onboarding ramp start is well-judged.

### B-2 — Likely difficulty SPIKE at depth 3 (three new threats land together) — **Med (PLAYTEST-CONFIRM)**
- [DIRECT] At **depth 3**, three step-ups coincide: (a) **ranged** enemies first appear (`rangedMinDepth:3`), (b) the **armored chaser** first appears if unlocked (`ENCOUNTER.armoredMinDepth:3`), and (c) the **boss gains its second phase** (`bossTwoPhaseMinDepth:3`). Then **depth 4** adds **swarmers** (`swarmerMinDepth:4`) and **depth 5** adds the **bruiser** + the first *summoning* (adds) two-phase boss (`bruiserMinDepth:5`; `Difficulty.ts:90-93` comment).
- [INFERENCE] Depths 1–2 are gentle (chaser-only), then 3–5 introduce a new threat type *every floor* while the linear stat curve also climbs. Depth 3 is the most loaded single step (new ranged behavior + new armor mechanic + boss escalation at once). This reads as a probable wall right after the gentle opening.
- **Severity:** Med — the underlying stat curve is smooth/monotonic by construction (no arithmetic spikes: health +0.18/d, dmg +0.12/d, speed +0.04/d, enemies +0.5/d), so the spike is from *content introduction cadence*, not numbers.
- **Direction:** consider staggering the depth-3 triple (e.g. push armored or the two-phase boss to depth 4) so each new threat gets a floor to itself. **PLAYTEST-CONFIRM** whether depth 3 actually feels like a wall — this is a structural inference, not a felt observation.

### B-3 — Mid/late curve is linear and may SAG into sameness — **Med (PLAYTEST-CONFIRM)** [INFERENCE]
- After depth ~5 every threat type is in the pool and only the linear multipliers climb (no new *mechanics* arrive — see D/E). The roster stops expanding at depth 5 but the win-line is depth 8, so depths 6–8 are "same enemies, bigger numbers." [INFERENCE] this stretch risks feeling flat right before the supposed climax. **PLAYTEST-CONFIRM.**

## C — The win-line W=8 (Craig's #1 open question)

### C-1 — W=8 has no climax, no victory, no acknowledgment — **High** [DIRECT]
- [DIRECT] `HEAT.unlockDepth = 8` (`constants.ts:1094`) is the win-line. But:
  - **No victory screen.** The only end-overlay is `RunSummary` ("RUN OVER"), shown solely on `state.runOver` (death/permadeath; `RunSummary.ts:2-3,110`). There is no "you won" screen.
  - **No depth cap / no stop.** `descendIfReady` just increments `state.run.depth` and loads the next floor (`GameState.ts:407,434`) with no bound at 8 — the game is **endless** past the win-line.
  - **No distinct final boss.** Boss variety is a 3-entry rotation by `(depth-1) % 3` (`Difficulty.ts:94-102`). Depth 8 → index 1 → `'adds'` — the *same* gimmick as depths 2 and 5, just at depth-8 stats. Nothing marks depth 8 as a finale.
  - **No acknowledgment.** Reaching depth 8 only records the hidden meta stat `reachedWinDepth: state.run.depth >= HEAT.unlockDepth` (`RunSummary.ts:130`), which unlocks Fire Rate + the Heat card *next* run. The player learns they "won" indirectly, after the fact. The RUN OVER screen looks identical whether they died at depth 2 or depth 12.
- **Severity:** High — the research's "final zone hits like a sledgehammer or a feather-duster": right now W=8 is *less* than a feather-duster, because there's no beat at all. The arc never "arrives."
- **Direction:** give W a real arrival beat — at minimum a distinct **VICTORY** screen at depth 8 (with the option to continue into the endless/Heat long-tail), and ideally a distinguished **final boss** at the win-line rather than the next rotation entry. This is the single biggest structural gap and directly answers Craig's "is 8 a satisfying climax?" — **structurally, no, not yet.** (Whether a *fixed* W=8 or a different number feels right is PLAYTEST; the missing *climax* is code-confirmed.)

## D — Meta-progression caliber (content gating vs interaction gating)

### D-1 — Mixed: one interaction-gating unlock, one content-gating — **Med / enhancement** [DIRECT]
- The unlock catalog (`Meta.ts:77-117`) is three items:
  - **Freeze** — "Your direct hits slow the enemies they strike." → a genuinely **new interaction** (a soft-CC/positioning tool that changes how you fight). *Interaction gating.* ✅
  - **Armored Chaser** — a tougher plated variant on deep floors → a new threat to read/handle; *leans* interaction but is close to "a chaser with more HP/an armor side." Borderline.
  - **Fire Rate** — "a new upgrade track that speeds up your ranged fire." → *more of an existing dimension* (faster shooting). **Content gating**, not new interaction.
- [INFERENCE] The meta reaches interaction-gating with freeze but not consistently; with only 3 unlocks and one being a pure stat track, the state space expands modestly. The research's bar ("the game keeps growing / new interaction patterns") is partially met.
- **Severity:** Med (enhancement) — the structure is sound and power-neutral (a real strength: unlocks are variety, never raw power; `Meta.ts:55`), it just doesn't yet reach as high as it could.
- **Direction:** favor future unlocks that create *new interactions* (new enemy *behaviors*, new tactical tools) over new stat tracks.

## E — Heat: texture or just numbers? (the Cogmind lens)

### E-1 — Heat is pure number-scaling — **High (for the long-tail)** [DIRECT]
- All four Heat modifiers (`Heat.ts:45-74`, applied at `heatStatMults`/`heatExtraEnemies` lines 111-123) are stat/count multipliers:
  - **Hard Labor** → enemy damage × (`hardLaborPerRank:0.15`)
  - **Swift Death** → enemy speed × (`swiftDeathPerRank:0.1`)
  - **Thick Skin** → enemy HP × (`thickSkinPerRank:0.2`)
  - **Crowd** → +enemies/room (`crowdPerRank:1`)
- [DIRECT] None changes a *rule* or *behavior* — no new attack patterns, no altered spawn logic, no tactical shift. Cranking Heat makes enemies tankier/faster/harder-hitting/denser, but you play **identically**.
- **Severity:** High *for the post-win long-tail specifically* — Heat is the endgame's longevity mechanism, and it's exactly the Cogmind anti-pattern ("nobody enjoys 'exactly the same but numbers higher'"). The base config being identity is a clean design (regression floor); the *content* of the ladder is the issue.
- **Direction:** add at least one **texture** modifier that changes *how* you play, not the numbers — e.g. enemies enrage below 50% HP, a "no pickups this floor" mutator, boss phase-2 from the start, denser-but-fragile swarms, etc. The 4 stat mods are a fine *baseline*; the ladder needs ≥1 tactic-altering option to stay interesting past the first few Heat levels. [INFERENCE on the felt longevity — PLAYTEST-CONFIRM how quickly pure-number Heat gets stale.]

## F — Holistic gaps

### F-1 — No per-floor variety (visual or mechanical) past the roster — **Med** [INFERENCE]
- [INFERENCE, partially DIRECT] Floors are generated by the same `Dungeon`/`buildEncounters` pipeline with no per-floor theming; combined with C-1 (endless after 8), D/E (no new mechanics past depth 5 except meta unlocks), the descent risks feeling same-y in the mid-to-late stretch. This **confirms the brief's "per-floor themes" backlog item** as a real arc need, not just polish.
- **Direction:** per-floor visual/mechanical themes would give the descent texture and make depths 6–8 feel like a build toward the (currently missing) climax.

### F-2 — Backlog priority cross-check [INFERENCE]
The brief named audio, per-floor themes, elites, synergy-surfacing as backlog. This arc review **independently confirms**: synergy-surfacing (→ A-1, raised to High) and per-floor themes (→ F-1). It **surfaces two items the brief's backlog list did not foreground as top priority**: the **W=8 climax/victory** (C-1) and **Heat texture** (E-1) — both High, both arguably *above* per-floor themes in arc impact. "Elites" would naturally help E-1 (an elite is a texture mechanic). Audio I did not deep-audit (synthesized, present; out of this recon's scope).

---

## Verdict

**Content:** clean and well-judged for an E10+ / US-kid profile, with a standout-clean data/privacy posture. No rating-relevant changes needed; one optional polish (dev surfaces).

**Arc:** the *foundations* are strong — gentle onboarding ramp, smooth stat curve, power-neutral meta. The **three High arc gaps cluster at the ends of the arc**: the *start* (the loop/goal/powerups aren't taught) and the *end* (W=8 has no climax; the Heat long-tail is numbers-only). Addressing C-1 (a real W=8 victory/finale) and E-1 (≥1 texture Heat mod), plus A-1 (teach the loop), would do the most to make the arc cohere and "arrive." Depth-3 spike (B-2) and per-floor variety (F-1) are the next tier. All feel-dependent calls are flagged PLAYTEST-CONFIRM.
