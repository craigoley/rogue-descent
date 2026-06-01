# Rogue Descent

Real-time twin-stick isometric roguelike dungeon crawler. Permadeath, with
**lateral** meta-progression (new options and playstyles between runs — NOT flat
power growth). TypeScript + Three.js + Vite. Deployed to Vercel as a static
site. Part of OleyArcade.

## Architecture
- src/game/ — pure TypeScript, ZERO three.js imports, Node-testable
- src/rendering/ — three.js layer, reads game state, never mutates it
- src/input/ — DOM keyboard/touch adapters that emit a pure InputIntent
- src/audio/ — Web Audio API, synthesized only, no audio files
- src/state/ — persistence (localStorage), Safari-Private-safe
- src/utils/ — constants (all tuning) + pure helpers
Loop: gather input -> game.update(dt) -> render -> repeat (fixed timestep).

## Hard rules
- NEVER import 'three' (or touch the DOM) anywhere under src/game/
- The player and every entity move via game STATE, never via input wired
  directly into the rAF loop in main.ts
- ALL tuning constants in utils/constants.ts — no magic numbers
- No external art assets — geometry is procedural (rooms, props, entities)
- No external audio files — sound is synthesized (Web Audio)
- Bounded object pools; no per-frame allocation in the game loop
- Mobile required: touch controls at parity with keyboard
- `?debug=1` is the funnel/telemetry surface — instrument through it
- Palette lives in constants.ts (PALETTE as 0xRRGGBB, CSS_PALETTE as hex)
- `npm run build` must pass before any PR
- Node pinned to 24.x (engines + .nvmrc)

## Working method
- Diagnose before patching: find the root cause, don't paper over symptoms
- Tests pin BEHAVIOR (expected values), not "it ran"
- Touch + keyboard parity is part of "done", not a follow-up

## Testing
Vitest on the pure src/game/ layer. Tests in src/game/__tests__/.
No WebGL tests needed — game logic is pure and deterministic.

## Deployment
Vercel auto-deploys on merge to main. Framework preset: Vite.
No server routes, no API endpoints — this is a static client app.

## PR workflow
Branch from latest main, PR, never commit to main directly.
Copilot + Claude Code review on PRs; the pipeline auto-merges iterative PRs
after review passes. PRs that change visuals or game feel open as DRAFT — they
need a real device playtest before merge, so drafts are gated out of auto-merge.
