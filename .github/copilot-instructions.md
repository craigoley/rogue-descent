# Rogue Descent — Copilot Review Instructions
Browser 3D game. Vite + TypeScript + Three.js. Isometric roguelike. No React, no SSR.
Flag on review:
- Any 'three' import OR DOM access (window/document/localStorage) under src/game/ (must be pure)
- Renderers in src/rendering/ that mutate game state (they must only read it)
- Magic numbers outside utils/constants.ts
- Object allocation inside the fixed-timestep / rAF loop
- Touch controls missing parity with keyboard
- Implicit any
- CommonJS require() (must be ESM for Vite)
