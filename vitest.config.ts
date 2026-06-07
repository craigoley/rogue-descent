import { defineConfig } from 'vitest/config';

// Vitest runs ONLY the pure-sim unit/integration tests under src/ (the L1 layer).
// Scoping `include` to src/**/*.test.ts keeps Vitest from picking up the Playwright
// E2E specs (tests/e2e/*.spec.ts, the L2 layer) — those run under `npm run test:e2e`
// (Playwright), never under `npm test`. So the PR auto-merge pipeline (which runs
// `npm test`) stays Vitest-only + fast.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
